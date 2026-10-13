import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises'
import type { ArticleTarget, EditorBuffer, EditorRecovery, ProjectInfo, RecoveryIndex, SaveArticleResult } from '../../shared/contracts'
import { contentKind, parseArticle } from '../adapters/promefire'
import { ARTICLE_SIZE_LIMIT, normalizedRelative, readBounded } from './paths'
import { ServiceError, isMissing, errorMessage } from './errors'
import { readGit } from './git'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const STORAGE_LIMIT = ARTICLE_SIZE_LIMIT * 7 + 65536

async function atomicJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(data), 'utf8'); await handle.sync() } finally { await handle.close() }
    await rename(temporary, file)
  } finally { await unlink(temporary).catch(() => undefined) }
}

function target(project: ProjectInfo, value: unknown): ArticleTarget {
  if (!value || typeof value !== 'object') throw new ServiceError('INVALID_EDITOR_INPUT', '文章参数无效。')
  const input = value as Partial<ArticleTarget>
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，请重新打开目标文章。')
  const relativePath = normalizedRelative(input.relativePath as string)
  if (!contentKind(relativePath)) throw new ServiceError('UNSUPPORTED_CONTENT', '只能保存当前项目的 Markdown 或 MDX 文章。')
  return { projectPath: project.path, relativePath }
}

function buffer(project: ProjectInfo, value: unknown): EditorBuffer {
  const article = target(project, value)
  const input = value as Partial<EditorBuffer>
  if (typeof input.source !== 'string' || input.source.includes('\0') || Buffer.byteLength(input.source) > ARTICLE_SIZE_LIMIT) throw new ServiceError('INVALID_EDITOR_INPUT', '源码必须为不含空字符的 UTF-8 文本，且不超过 4 MB。')
  if (typeof input.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new ServiceError('INVALID_EDITOR_INPUT', '缺少原文件版本，请重新打开文章。')
  return { ...article, source: input.source, baseRevision: input.baseRevision }
}

async function writableFile(project: ProjectInfo, relative: string): Promise<{ file: string; mode: number }> {
  if (await realpath(project.path) !== project.path) throw new ServiceError('PROJECT_PATH_CHANGED', '项目路径已改变，请重新选择目录。')
  const parts = relative.split('/')
  let file = project.path
  let mode = 0
  for (let i = 0; i < parts.length; i++) {
    file = path.join(file, parts[i])
    const info = await lstat(file)
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink > 1)) throw new ServiceError('UNSAFE_WRITE_PATH', '文章路径包含链接或不是普通文件，已拒绝保存。')
    mode = info.mode
  }
  if (path.relative(file, await realpath(file))) throw new ServiceError('UNSAFE_WRITE_PATH', '文章路径指向其他位置，已拒绝保存。')
  return { file, mode }
}

export function createEditorService(storage: string) {
  const prefix = (project: ProjectInfo) => `${hash(project.path)}-`
  const recoveryFile = (project: ProjectInfo, relative: string) => path.join(storage, 'recovery', `${prefix(project)}${hash(relative)}.json`)

  async function checkpoint(project: ProjectInfo, value: unknown): Promise<EditorRecovery> {
    const input = buffer(project, value)
    // Never silently replace an unreadable recovery record.
    await get(project, input)
    const record: EditorRecovery = { ...input, updatedAt: new Date().toISOString() }
    await atomicJson(recoveryFile(project, input.relativePath), record)
    return record
  }
  async function get(project: ProjectInfo, value: unknown): Promise<EditorRecovery | null> {
    const input = target(project, value)
    try {
      const record = JSON.parse((await readBounded(recoveryFile(project, input.relativePath), STORAGE_LIMIT)).text) as EditorRecovery
      const valid = buffer(project, record)
      if (valid.relativePath !== input.relativePath || typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt))) throw new Error('恢复记录字段无效')
      return { ...valid, updatedAt: record.updatedAt }
    } catch (error) {
      if (isMissing(error)) return null
      throw new ServiceError('RECOVERY_CORRUPT', '恢复记录无法读取，原文件已保留。')
    }
  }
  async function clear(project: ProjectInfo, value: unknown): Promise<void> {
    const input = target(project, value)
    await unlink(recoveryFile(project, input.relativePath)).catch(error => { if (!isMissing(error)) throw error })
  }
  async function list(project: ProjectInfo): Promise<RecoveryIndex> {
    const result: RecoveryIndex = { entries: [], issues: [] }
    let files: string[]
    try { files = await readdir(path.join(storage, 'recovery')) } catch (error) { if (isMissing(error)) return result; throw error }
    const matching = files.filter(name => name.startsWith(prefix(project)) && name.endsWith('.json'))
    if (matching.length > 1000) result.issues.push('恢复记录超过 1,000 条，本次仅显示前 1,000 条。')
    for (const file of matching.slice(0, 1000)) {
      try {
        const record = JSON.parse((await readBounded(path.join(storage, 'recovery', file), STORAGE_LIMIT)).text)
        const valid = await get(project, target(project, record))
        if (!valid || path.basename(recoveryFile(project, valid.relativePath)) !== file) throw new Error('恢复记录名称无效')
        result.entries.push({ projectPath: project.path, relativePath: valid.relativePath, updatedAt: valid.updatedAt })
      } catch { result.issues.push(`无法读取恢复记录 ${file}，原文件已保留。`) }
    }
    result.entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return result
  }
  async function save(project: ProjectInfo, value: unknown): Promise<SaveArticleResult> {
    const input = buffer(project, value)
    // Persist the user buffer before any validation that might fail or conflict.
    await checkpoint(project, input)
    const { file, mode } = await writableFile(project, input.relativePath)
    const original = await readBounded(file, ARTICLE_SIZE_LIMIT)
    const assertRevision = (source: string) => {
      if (hash(source) !== input.baseRevision) throw new ServiceError('REVISION_CONFLICT', '磁盘文件已被其他程序修改，未覆盖原文件。你的编辑内容仍保留，可重新加载磁盘版本或从恢复记录取回。')
    }
    assertRevision(original.text)
    const document = parseArticle(input.source, input.relativePath, contentKind(input.relativePath)!, { modifiedAt: new Date().toISOString(), size: Buffer.byteLength(input.source), fileStatus: 'unknown' })
    if (document.article.issues.length) throw new ServiceError('INVALID_FRONTMATTER', `请修正文章属性后保存：${document.article.issues.join('；')}`)
    const temporary = path.join(path.dirname(file), `.astro-desktop-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', mode & 0o777)
      try {
        await handle.writeFile(input.source, 'utf8')
        await handle.sync()
        document.article.modifiedAt = (await handle.stat()).mtime.toISOString()
      } finally { await handle.close() }
      await chmod(temporary, mode & 0o777)
      // A local backup is required before replacing the original; it never enters the blog repo.
      await atomicJson(path.join(storage, 'backups', `${prefix(project)}${hash(input.relativePath)}-${input.baseRevision}.json`), { ...input, source: original.text, updatedAt: new Date().toISOString() })
      await writableFile(project, input.relativePath)
      assertRevision((await readBounded(file, ARTICLE_SIZE_LIMIT)).text)
      await rename(temporary, file)
    } finally { await unlink(temporary).catch(() => undefined) }
    // Once rename succeeds, recovery cleanup must not turn a real save into an apparent failure.
    let recoveryWarning: string | null = null
    try { await clear(project, input) } catch { recoveryWarning = '文章已保存，但旧恢复记录暂时无法清理。' }
    const git = await readGit(project.path)
    const ignored = [...git.statuses].some(([entry, status]) => status === 'ignored' && input.relativePath.startsWith(`${entry.replace(/\/$/, '')}/`))
    document.article.fileStatus = git.statusAvailable ? git.statuses.get(input.relativePath) ?? (ignored ? 'ignored' : 'clean') : 'unknown'
    return { document, recoveryWarning }
  }
  return {
    checkpoint, get, clear, list,
    async move(project: ProjectInfo, from: string, to: string): Promise<void> {
      const record = await get(project, { projectPath: project.path, relativePath: from })
      if (!record) return
      const next: EditorRecovery = { ...record, relativePath: to }
      await atomicJson(recoveryFile(project, to), next)
      try { await clear(project, { projectPath: project.path, relativePath: from }) }
      catch (error) {
        await unlink(recoveryFile(project, to)).catch(() => undefined)
        throw error
      }
    },
    save: async (project: ProjectInfo, value: unknown) => {
      try { return await save(project, value) } catch (error) {
        if (error instanceof ServiceError) throw error
        if (isMissing(error)) throw new ServiceError('FILE_MISSING', '原文件或目录无法访问。请保留编辑器内容，检查恢复记录或另存副本。')
        throw new ServiceError('SAVE_FAILED', `保存失败，请保留编辑器内容或另存副本：${errorMessage(error)}`)
      }
    },
  }
}
