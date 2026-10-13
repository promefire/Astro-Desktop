import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, readdir, rename, rm, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { ArticleDocument, ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, contentKind, parseArticle } from '../adapters/promefire'
import { articleStem, assetDirectory, linkedDestinations, pathInsideDirectory, resolveMarkdownPath } from '../../shared/image-path'
import { ServiceError, isMissing } from './errors'
import { readBounded } from './paths'
import { readGit } from './git'

export type ImageAction = 'moved' | 'copied' | 'none'
export interface PublishHooks { failAfter?: 'article-renamed' | 'source-removed' }

const DRAFT_ROOT = `${CONTENT_DIRECTORIES.draft}/`

export function publishInput(project: ProjectInfo, value: unknown): { relativePath: string; baseRevision: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_PUBLISH', '发布参数无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['projectPath', 'relativePath', 'baseRevision'].includes(key))) throw new ServiceError('INVALID_PUBLISH', '发布只接受当前草稿的路径和版本。')
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，没有移动文件。')
  if (typeof input.relativePath !== 'string' || typeof input.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new ServiceError('INVALID_PUBLISH', '发布参数无效。')
  if (contentKind(input.relativePath) !== 'draft') throw new ServiceError('NOT_A_DRAFT', '只有 src/contents/drafts 中的文章可以发布到正文。')
  return { relativePath: input.relativePath, baseRevision: input.baseRevision }
}

async function absent(file: string): Promise<boolean> {
  try { await lstat(file); return false } catch (error) { if (isMissing(error)) return true; throw error }
}

async function realTree(directory: string): Promise<'missing' | 'shared-link' | 'directory'> {
  let info
  try { info = await lstat(directory) } catch (error) { if (isMissing(error)) return 'missing'; throw error }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new ServiceError('UNSAFE_PUBLISH', '图片路径不是实际目录，已停止发布。')
  const entries = await readdir(directory)
  for (const name of entries) {
    const child = await lstat(path.join(directory, name))
    if (child.isSymbolicLink()) throw new ServiceError('UNSAFE_PUBLISH', '图片目录包含链接，已停止发布。')
    if (child.isDirectory()) {
      if (await realTree(path.join(directory, name)) === 'shared-link') return 'shared-link'
    } else if (!child.isFile()) throw new ServiceError('UNSAFE_PUBLISH', '图片目录包含无法移动的项目，已停止发布。')
    else if (child.nlink > 1) return 'shared-link'
  }
  return 'directory'
}

async function referencedByOthers(project: ProjectInfo, articlePath: string, assetRelative: string): Promise<boolean> {
  for (const root of Object.values(CONTENT_DIRECTORIES)) {
    const files = await collect(path.join(project.path, ...root.split('/')), root)
    for (const relative of files) {
      if (relative === articlePath || !contentKind(relative)) continue
      const source = (await readBounded(path.join(project.path, ...relative.split('/')), 4 * 1024 * 1024)).text
      for (const destination of linkedDestinations(source)) {
        const resolved = resolveMarkdownPath(relative, destination)
        if (resolved && pathInsideDirectory(resolved, assetRelative)) return true
      }
    }
  }
  return false
}

async function collect(directory: string, relative: string): Promise<string[]> {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { if (isMissing(error)) return []; throw error }
  const files: string[] = []
  for (const entry of entries) {
    const next = `${relative}/${entry.name}`
    if (entry.isDirectory()) files.push(...await collect(path.join(directory, entry.name), next))
    else if (entry.isFile() && contentKind(next)) files.push(next)
  }
  return files
}

export async function publishDraft(project: ProjectInfo, value: unknown, moveRecovery: (from: string, to: string) => Promise<void>, hooks: PublishHooks = {}): Promise<{ document: ArticleDocument; imageAction: ImageAction; message: string }> {
  const input = publishInput(project, value)
  if (!input.relativePath.startsWith(DRAFT_ROOT)) throw new ServiceError('NOT_A_DRAFT', '只有草稿目录中的文章可以发布到正文。')
  const sourceRelative = input.relativePath
  const targetRelative = `${CONTENT_DIRECTORIES.post}/${sourceRelative.slice(DRAFT_ROOT.length)}`
  const sourceAsset = assetDirectory(sourceRelative)
  const targetAsset = assetDirectory(targetRelative)
  const sourceFile = path.join(project.path, ...sourceRelative.split('/'))
  const targetFile = path.join(project.path, ...targetRelative.split('/'))
  const sourceAssetPath = path.join(project.path, ...sourceAsset.split('/'))
  const targetAssetPath = path.join(project.path, ...targetAsset.split('/'))
  const extension = path.extname(sourceFile)
  const stem = articleStem(sourceRelative)
  const sibling = path.join(path.dirname(targetFile), `${stem}${extension === '.mdx' ? '.md' : '.mdx'}`)
  const disk = await readBounded(sourceFile, 4 * 1024 * 1024)
  if (createHash('sha256').update(disk.text).digest('hex') !== input.baseRevision) throw new ServiceError('REVISION_CONFLICT', '磁盘上的草稿已变化，没有发布。请保留编辑内容，重新加载后再试。')
  if (!await absent(targetFile) || !await absent(targetAssetPath) || !await absent(sibling)) throw new ServiceError('PUBLISH_CONFLICT', '正文里已经有同名文章或图片目录，已停止，没有覆盖或改名。')
  const assetState = await realTree(sourceAssetPath)
  const shared = assetState === 'shared-link' || (assetState === 'directory' && await referencedByOthers(project, sourceRelative, sourceAsset))
  const articleTemp = path.join(path.dirname(targetFile), `.astro-desktop-publish-${randomUUID()}.tmp`)
  const assetTemp = path.join(path.dirname(targetAssetPath), `.astro-desktop-publish-${randomUUID()}`)
  let stage: 'clean' | 'article' | 'both' | 'source-file' | 'source-asset' = 'clean'
  try {
    await mkdir(path.dirname(targetFile), { recursive: false }).catch(error => { if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
    await copyFile(sourceFile, articleTemp)
    await rename(articleTemp, targetFile)
    stage = 'article'
    if (hooks.failAfter === 'article-renamed') throw new ServiceError('PUBLISH_INTERRUPTED', '发布在移动文章后中断，正在恢复。')
    if (assetState !== 'missing') {
      await cp(sourceAssetPath, assetTemp, { recursive: true, errorOnExist: true })
      await rename(assetTemp, targetAssetPath)
      stage = 'both'
    }
    await unlink(sourceFile)
    stage = 'source-file'
    if (hooks.failAfter === 'source-removed') throw new ServiceError('PUBLISH_INTERRUPTED', '发布在移走原文件后中断，正在恢复。')
    if (assetState !== 'missing' && !shared) {
      await rm(sourceAssetPath, { recursive: true })
      stage = 'source-asset'
    }
    await moveRecovery(sourceRelative, targetRelative)
  } catch (error) {
    await rollback({ stage, sourceFile, targetFile, sourceAssetPath, targetAssetPath, assetTemp, articleTemp, shared, assetState })
    if (error instanceof ServiceError) throw error
    throw new ServiceError('PUBLISH_FAILED', '发布没有完成，原草稿已保留。')
  }
  const git = await readGit(project.path)
  const ignored = [...git.statuses].some(([entry, status]) => status === 'ignored' && targetRelative.startsWith(`${entry.replace(/\/$/, '')}/`))
  const document = parseArticle(disk.text, targetRelative, 'post', {
    modifiedAt: disk.modifiedAt, size: disk.size,
    fileStatus: git.statusAvailable ? git.statuses.get(targetRelative) ?? (ignored ? 'ignored' : 'untracked') : 'unknown',
  })
  const imageAction: ImageAction = assetState === 'missing' ? 'none' : shared ? 'copied' : 'moved'
  const message = imageAction === 'moved' ? '已转入正文，图片目录已一并移动。没有提交或部署。'
    : imageAction === 'copied' ? '已转入正文。图片仍被其他文章使用，已复制到正文并保留原目录。没有提交或部署。'
      : '已转入正文。这篇没有本地图片目录。没有提交或部署。'
  return { document, imageAction, message }
}

async function rollback(state: { stage: string; sourceFile: string; targetFile: string; sourceAssetPath: string; targetAssetPath: string; assetTemp: string; articleTemp: string; shared: boolean; assetState: string }): Promise<void> {
  if (state.stage === 'source-asset' || state.stage === 'source-file') {
    if (state.stage === 'source-asset') await rename(state.targetAssetPath, state.sourceAssetPath).catch(() => undefined)
    else if (state.assetState !== 'missing' && !(await absent(state.targetAssetPath))) {
      if (await absent(state.sourceAssetPath)) await rename(state.targetAssetPath, state.sourceAssetPath).catch(() => undefined)
      else await rm(state.targetAssetPath, { recursive: true }).catch(() => undefined)
    }
    if (!(await absent(state.sourceFile))) await unlink(state.targetFile).catch(() => undefined)
    else await rename(state.targetFile, state.sourceFile).catch(() => undefined)
    return
  }
  if (!(await absent(state.targetFile))) await unlink(state.targetFile).catch(() => undefined)
  if (!(await absent(state.targetAssetPath))) await rm(state.targetAssetPath, { recursive: true }).catch(() => undefined)
  await unlink(state.articleTemp).catch(() => undefined)
  await rm(state.assetTemp, { recursive: true, force: true }).catch(() => undefined)
}
