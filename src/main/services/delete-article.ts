import path from 'node:path'
import { lstat, realpath, unlink } from 'node:fs/promises'
import type { ArticleTarget, ProjectInfo } from '../../shared/contracts'
import { contentKind } from '../adapters/promefire'
import { normalizedRelative } from './paths'
import { ServiceError, isMissing } from './errors'

export function deleteArticleInput(project: ProjectInfo, value: unknown): ArticleTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_DELETE', '删除参数无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => key !== 'projectPath' && key !== 'relativePath')) throw new ServiceError('INVALID_DELETE', '删除只接受当前项目中的文章路径。')
  if (typeof input.relativePath !== 'string' || input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，没有删除文件。')
  const relativePath = normalizedRelative(input.relativePath)
  if (!contentKind(relativePath)) throw new ServiceError('UNSUPPORTED_CONTENT', '只能删除正文、草稿或 AI 日报文件。')
  return { projectPath: project.path, relativePath }
}

export async function removeArticleFile(project: ProjectInfo, relativePath: string): Promise<void> {
  if (await realpath(project.path) !== project.path) throw new ServiceError('PROJECT_PATH_CHANGED', '项目路径已改变，请重新选择目录。')
  const parts = relativePath.split('/')
  let file = project.path
  for (let index = 0; index < parts.length; index += 1) {
    file = path.join(file, parts[index])
    let info
    try { info = await lstat(file) } catch (error) {
      if (isMissing(error)) throw new ServiceError('FILE_MISSING', '文章已经不在磁盘上。')
      throw error
    }
    const last = index === parts.length - 1
    if (info.isSymbolicLink() || (last ? !info.isFile() || info.nlink > 1 : !info.isDirectory())) {
      throw new ServiceError('UNSAFE_DELETE_PATH', '文章路径包含链接或不是普通文件，已拒绝删除。')
    }
  }
  if (path.relative(file, await realpath(file))) throw new ServiceError('UNSAFE_DELETE_PATH', '文章路径指向其他位置，已拒绝删除。')
  try { await unlink(file) } catch (error) {
    if (isMissing(error)) throw new ServiceError('FILE_MISSING', '文章已经不在磁盘上。')
    throw new ServiceError('DELETE_FAILED', '无法删除文章，请检查文件是否被占用或没有写入权限。')
  }
}
