import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import type { ArticleDocument, CreateDraftInput, ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, parseArticle } from '../adapters/promefire'
import { ServiceError, isMissing } from './errors'
import { readGit } from './git'

export function validateDraftInput(value: unknown): CreateDraftInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_DRAFT', '新建文章参数无效。')
  const input = value as Record<string, unknown>
  const fields = ['projectPath', 'title', 'tags', 'category', 'description']
  if (Object.keys(input).some(key => !fields.includes(key))) throw new ServiceError('INVALID_DRAFT', '新建操作仅支持普通文章的标题、标签、分类和摘要。')
  function text(key: string, label: string, limit: number, multiline = false): string {
    const field = input[key]
    if (typeof field !== 'string' || field.length > limit || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(field)) {
      throw new ServiceError('INVALID_DRAFT', `${label}格式无效或超过 ${limit} 字符。`)
    }
    return field.trim()
  }
  const title = text('title', '文章标题', 200)
  if (!title) throw new ServiceError('INVALID_DRAFT', '文章标题不能为空。')
  if (!Array.isArray(input.tags) || input.tags.length > 32 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80 || /[\u0000-\u001f\u007f]/.test(tag))) {
    throw new ServiceError('INVALID_DRAFT', '标签最多 32 个，每个标签为 1–80 字符。')
  }
  return {
    projectPath: text('projectPath', '项目路径', 32768), title,
    tags: [...new Set((input.tags as string[]).map(tag => tag.trim()))],
    category: text('category', '分类', 80), description: text('description', '摘要', 2000, true),
  }
}

function fileStem(title: string): string {
  let stem = Array.from(title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ')).slice(0, 80).join('').replace(/^[ .]+|[ .]+$/g, '')
  if (!stem) stem = '未命名文章'
  // Windows reserves device names even when followed by an extension.
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `文章-${stem}`
  return stem
}

function draftSource(input: CreateDraftInput): string {
  const now = new Date()
  const pad = (part: number) => String(part).padStart(2, '0')
  const published = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  // JSON strings are valid YAML scalars and quote YAML 1.1 words such as "on".
  // Keep the generated timestamp plain so Astro's YAML loader receives a Date.
  return [
    '---', `title: ${JSON.stringify(input.title)}`, `published: ${published}`,
    `description: ${JSON.stringify(input.description)}`, `tags: ${JSON.stringify(input.tags)}`,
    `category: ${JSON.stringify(input.category)}`, '---', '', '',
  ].join('\n')
}

async function writableCollection(project: ProjectInfo): Promise<string> {
  if (await realpath(project.path) !== project.path) throw new ServiceError('PROJECT_PATH_CHANGED', '项目路径已发生变化，请重新选择目录。')
  const segments = CONTENT_DIRECTORIES.draft.split('/')
  let directory = project.path
  for (let index = 0; index < segments.length; index += 1) {
    const next = path.join(directory, segments[index])
    let info
    try { info = await lstat(next) } catch (error) {
      if (!isMissing(error) || index !== segments.length - 1) throw error
      try { await mkdir(next) } catch (created) {
        if (!created || typeof created !== 'object' || !('code' in created) || created.code !== 'EEXIST') throw created
      }
      info = await lstat(next)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ServiceError('UNSAFE_WRITE_PATH', '草稿目录包含链接或不是实际目录，已拒绝新建。')
    if (path.relative(next, await realpath(next))) throw new ServiceError('UNSAFE_WRITE_PATH', '草稿目录指向其他位置，已拒绝新建。')
    directory = next
  }
  return directory
}

async function nameTaken(directory: string, stem: string): Promise<boolean> {
  for (const name of [`${stem}.md`, `${stem}.mdx`, stem]) {
    try { await lstat(path.join(directory, name)); return true } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
  return false
}

export async function createDraft(project: ProjectInfo, input: CreateDraftInput): Promise<ArticleDocument> {
  try { return await writeDraft(project, input) } catch (error) {
    if (error instanceof ServiceError) throw error
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code === 'ENOENT') throw new ServiceError('CREATE_FAILED', '草稿目录的上级目录不存在，请恢复 src/contents 后重试。')
    if (code === 'EACCES' || code === 'EPERM') throw new ServiceError('CREATE_FAILED', '无法写入草稿目录，请检查文件夹权限或文件是否被占用。')
    if (code === 'ENOSPC') throw new ServiceError('CREATE_FAILED', '磁盘空间不足，无法创建草稿。')
    throw new ServiceError('CREATE_FAILED', '草稿创建失败，请检查项目目录、写入权限和磁盘空间后重试。')
  }
}

async function writeDraft(project: ProjectInfo, input: CreateDraftInput): Promise<ArticleDocument> {
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，请在目标项目重新新建文章。')
  const directory = await writableCollection(project)
  const source = draftSource(input)
  const temporary = path.join(directory, `.astro-desktop-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx')
  let relativePath = ''
  let modifiedAt: string
  try {
    try {
      await handle.writeFile(source, 'utf8')
      await handle.sync()
      modifiedAt = (await handle.stat()).mtime.toISOString()
    } finally { await handle.close() }
    const stem = fileStem(input.title)
    for (let suffix = 1; suffix <= 1000; suffix++) {
      await writableCollection(project)
      const name = `${stem}${suffix === 1 ? '' : `-${suffix}`}.md`
      if (await nameTaken(directory, name.slice(0, -3))) continue
      try {
        // A hard link publishes the complete file without replacing an existing name.
        // Unlike rename on Windows/Unix, an occupied target always fails.
        await link(temporary, path.join(directory, name))
        relativePath = `${CONTENT_DIRECTORIES.draft}/${name}`
        break
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') continue
        throw new ServiceError('CREATE_FAILED', '无法创建草稿。请检查写入权限及磁盘空间；所在磁盘需要支持硬链接（如 NTFS）。')
      }
    }
    if (!relativePath) throw new ServiceError('NAME_CONFLICT', '同名文章过多，请修改标题后重试。')
  } finally {
    // Only remove our exclusive temporary file. A committed article stays successful
    // even if antivirus temporarily locks the leftover .tmp; scanners ignore .tmp.
    await unlink(temporary).catch(() => undefined)
  }
  const git = await readGit(project.path)
  const ignored = [...git.statuses].some(([entry, status]) => status === 'ignored' && relativePath.startsWith(`${entry.replace(/\/$/, '')}/`))
  return parseArticle(source, relativePath, 'draft', {
    modifiedAt, size: Buffer.byteLength(source),
    fileStatus: git.statusAvailable ? git.statuses.get(relativePath) ?? (ignored ? 'ignored' : 'untracked') : 'unknown',
  })
}
