import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, readdir, realpath, rename, rm, unlink } from 'node:fs/promises'
import type { ArticleDocument, ContentKind, ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, contentKind, parseArticle } from '../adapters/promefire'
import { articleStem, assetDirectory, linkedDestinations, pathInsideDirectory, resolveMarkdownPath } from '../../shared/image-path'
import { ServiceError, isMissing } from './errors'
import { readBounded } from './paths'
import { readGit } from './git'

export type ImageAction = 'moved' | 'copied' | 'none'
export interface MoveHooks { failAfter?: 'article-renamed' | 'source-removed' }
export interface MoveResult { document: ArticleDocument; imageAction: ImageAction; message: string }

/** The wording and error codes that separate 草稿 → 正文 from 正文 → 草稿. */
export interface MoveDirection {
  action: string
  sourceWord: string
  targetWord: string
  done: string
  targetKind: ContentKind
  conflictCode: string
  interruptedCode: string
  failedCode: string
  unsafeCode: string
}

export interface MoveRequest { sourceRelative: string; targetRelative: string; baseRevision: string }

async function absent(file: string): Promise<boolean> {
  try { await lstat(file); return false } catch (error) { if (isMissing(error)) return true; throw error }
}

async function realTree(directory: string, direction: MoveDirection): Promise<'missing' | 'shared-link' | 'directory'> {
  let info
  try { info = await lstat(directory) } catch (error) { if (isMissing(error)) return 'missing'; throw error }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new ServiceError(direction.unsafeCode, `图片路径不是实际目录，已停止${direction.action}。`)
  const entries = await readdir(directory)
  for (const name of entries) {
    const child = await lstat(path.join(directory, name))
    if (child.isSymbolicLink()) throw new ServiceError(direction.unsafeCode, `图片目录包含链接，已停止${direction.action}。`)
    if (child.isDirectory()) {
      if (await realTree(path.join(directory, name), direction) === 'shared-link') return 'shared-link'
    } else if (!child.isFile()) throw new ServiceError(direction.unsafeCode, `图片目录包含无法移动的项目，已停止${direction.action}。`)
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

/**
 * Create the target directory inside the project and refuse links, so a relocation never
 * writes through a junction and never escapes the selected blog root.
 */
async function prepareTargetDirectory(project: ProjectInfo, relative: string, direction: MoveDirection): Promise<void> {
  if (await realpath(project.path) !== project.path) throw new ServiceError('PROJECT_PATH_CHANGED', '项目路径已改变，请重新选择目录。')
  let directory = project.path
  for (const segment of relative.split('/')) {
    directory = path.join(directory, segment)
    let info
    try { info = await lstat(directory) } catch (error) {
      if (!isMissing(error)) throw error
      try { await mkdir(directory) } catch (created) {
        if (!created || typeof created !== 'object' || !('code' in created) || created.code !== 'EEXIST') throw created
      }
      info = await lstat(directory)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ServiceError(direction.unsafeCode, `${relative} 包含链接或不是实际目录，已停止${direction.action}。`)
    if (path.relative(directory, await realpath(directory))) throw new ServiceError(direction.unsafeCode, `${relative} 指向其他位置，已停止${direction.action}。`)
  }
}

/**
 * Move one article, and its sibling image directory, between content directories.
 * The caller validates the request, the frontmatter is never rewritten, and nothing is
 * committed, built, or deployed. Failures roll back to the original state.
 */
export async function moveArticle(
  project: ProjectInfo,
  request: MoveRequest,
  direction: MoveDirection,
  moveRecovery: (from: string, to: string) => Promise<void>,
  hooks: MoveHooks = {},
): Promise<MoveResult> {
  const { sourceRelative, targetRelative } = request
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
  if (createHash('sha256').update(disk.text).digest('hex') !== request.baseRevision) throw new ServiceError('REVISION_CONFLICT', `磁盘上的${direction.sourceWord}已变化，没有${direction.action}。请保留编辑内容，重新加载后再试。`)
  if (!await absent(targetFile) || !await absent(targetAssetPath) || !await absent(sibling)) throw new ServiceError(direction.conflictCode, `${direction.targetWord}里已经有同名文章或图片目录，已停止，没有覆盖或改名。`)
  const assetState = await realTree(sourceAssetPath, direction)
  const shared = assetState === 'shared-link' || (assetState === 'directory' && await referencedByOthers(project, sourceRelative, sourceAsset))
  const articleTemp = path.join(path.dirname(targetFile), `.astro-desktop-move-${randomUUID()}.tmp`)
  const assetTemp = path.join(path.dirname(targetAssetPath), `.astro-desktop-move-${randomUUID()}`)
  let stage: 'clean' | 'article' | 'both' | 'source-file' | 'source-asset' = 'clean'
  try {
    await prepareTargetDirectory(project, path.dirname(targetRelative), direction)
    await copyFile(sourceFile, articleTemp)
    await rename(articleTemp, targetFile)
    stage = 'article'
    if (hooks.failAfter === 'article-renamed') throw new ServiceError(direction.interruptedCode, `${direction.action}在移动文章后中断，正在恢复。`)
    if (assetState !== 'missing') {
      await cp(sourceAssetPath, assetTemp, { recursive: true, errorOnExist: true })
      await rename(assetTemp, targetAssetPath)
      stage = 'both'
    }
    await unlink(sourceFile)
    stage = 'source-file'
    if (hooks.failAfter === 'source-removed') throw new ServiceError(direction.interruptedCode, `${direction.action}在移走原文件后中断，正在恢复。`)
    if (assetState !== 'missing' && !shared) {
      await rm(sourceAssetPath, { recursive: true })
      stage = 'source-asset'
    }
    await moveRecovery(sourceRelative, targetRelative)
  } catch (error) {
    await rollback({ stage, sourceFile, targetFile, sourceAssetPath, targetAssetPath, assetTemp, articleTemp, assetState })
    if (error instanceof ServiceError) throw error
    throw new ServiceError(direction.failedCode, `${direction.action}没有完成，原${direction.sourceWord}已保留。`)
  }
  const git = await readGit(project.path)
  const ignored = [...git.statuses].some(([entry, status]) => status === 'ignored' && targetRelative.startsWith(`${entry.replace(/\/$/, '')}/`))
  const document = parseArticle(disk.text, targetRelative, direction.targetKind, {
    modifiedAt: disk.modifiedAt, size: disk.size,
    fileStatus: git.statusAvailable ? git.statuses.get(targetRelative) ?? (ignored ? 'ignored' : 'untracked') : 'unknown',
  })
  const imageAction: ImageAction = assetState === 'missing' ? 'none' : shared ? 'copied' : 'moved'
  const message = imageAction === 'moved' ? `${direction.done}，图片目录已一并移动。没有提交或部署。`
    : imageAction === 'copied' ? `${direction.done}。图片仍被其他文章使用，已复制到${direction.targetWord}并保留原目录。没有提交或部署。`
      : `${direction.done}。这篇没有本地图片目录。没有提交或部署。`
  return { document, imageAction, message }
}

async function rollback(state: { stage: string; sourceFile: string; targetFile: string; sourceAssetPath: string; targetAssetPath: string; assetTemp: string; articleTemp: string; assetState: string }): Promise<void> {
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
