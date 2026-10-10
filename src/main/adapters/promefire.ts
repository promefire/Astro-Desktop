import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import type { ArticleDocument, ContentKind, FileStatus, ProjectInfo } from '../../shared/contracts'
import { ServiceError } from '../services/errors'
import { ensureDirectory, readBounded, safePath } from '../services/paths'
import { readGit } from '../services/git'

export const CONTENT_DIRECTORIES: Record<ContentKind, string> = { post: 'src/contents/post', 'ai-daily': 'src/contents/ai-daily' }
export function contentKind(relative: string): ContentKind | null {
  const lower = relative.toLowerCase()
  if (relative.startsWith(`${CONTENT_DIRECTORIES.post}/`) && /\.mdx?$/.test(lower)) return 'post'
  if (relative.startsWith(`${CONTENT_DIRECTORIES['ai-daily']}/`) && lower.endsWith('.md')) return 'ai-daily'
  return null
}

export async function inspectProject(directory: string): Promise<ProjectInfo> {
  if (typeof directory !== 'string' || !directory || !path.isAbsolute(directory)) throw new ServiceError('INVALID_PROJECT', '请选择完整的本地博客目录路径。')
  const root = await realpath(directory)
  if (!(await stat(root)).isDirectory()) throw new ServiceError('INVALID_PROJECT', '请选择博客目录。')
  let pkg: Record<string, unknown>
  try { pkg = JSON.parse((await readBounded(await safePath(root, 'package.json'), 1024 * 1024)).text) } catch {
    throw new ServiceError('INVALID_PROJECT', '无法读取 package.json；请选择 Astro 博客根目录。')
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new ServiceError('INVALID_PROJECT', 'package.json 格式无效。')
  const dependencies = { ...(typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}), ...(typeof pkg.dependencies === 'object' ? pkg.dependencies : {}) } as Record<string, unknown>
  if (typeof dependencies.astro !== 'string' || !dependencies.astro.trim()) throw new ServiceError('INVALID_PROJECT', 'package.json 未声明 astro 依赖。')
  for (const relative of Object.values(CONTENT_DIRECTORIES)) {
    try { await ensureDirectory(root, relative) } catch (error) {
      if (error instanceof ServiceError && error.code === 'PATH_OUTSIDE_PROJECT') throw error
      throw new ServiceError('INVALID_PROJECT', `缺少内容目录 ${relative}；本版本适配 promefire/Astro_Blog 的目录结构。`)
    }
  }
  const scripts: Record<string, string> = {}
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const [name, command] of Object.entries(pkg.scripts)) if (typeof command === 'string') Object.defineProperty(scripts, name, { value: command, enumerable: true })
  }
  const git = await readGit(root)
  return {
    name: path.basename(root), path: root, adapter: 'promefire-astro-blog', astroVersion: dependencies.astro,
    packageManager: typeof pkg.packageManager === 'string' ? pkg.packageManager : null,
    scripts, git: git.info, contentDirectories: { ...CONTENT_DIRECTORIES }, warnings: git.info.error ? [git.info.error] : [],
  }
}

/** Preserve the authored calendar day and timezone; never reinterpret it through the host timezone. */
export function parsePublished(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(?:\s*([Zz]|[+-]\d{2}:?\d{2}))?)?$/.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction, zone] = match
  const y = Number(year), m = Number(month), d = Number(day)
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null
  const calendar = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  if (hour === undefined) return calendar
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return null
  if (zone && !/z/i.test(zone) && (Number(zone.slice(1, 3)) > 23 || Number(zone.replace(':', '').slice(3)) > 59)) return null
  const suffix = zone ? (/z/i.test(zone) ? 'Z' : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`) : ''
  return `${calendar}T${hour.padStart(2, '0')}:${minute}:${second ?? '00'}${fraction ?? ''}${suffix}`
}

function assertSafeData(value: unknown, seen = new Set<object>(), depth = 0, budget = { remaining: 20000 }): void {
  if (--budget.remaining < 0 || depth > 30) throw new Error('frontmatter 结构过于复杂')
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (typeof value !== 'object' || value === null || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) throw new Error('frontmatter 包含不支持的数据类型')
  if (seen.has(value)) throw new Error('frontmatter 包含循环引用')
  seen.add(value)
  for (const child of Object.values(value)) assertSafeData(child, seen, depth + 1, budget)
  seen.delete(value)
}

export function parseArticle(source: string, relativePath: string, kind: ContentKind, meta: { modifiedAt: string; size: number; fileStatus: FileStatus }): ArticleDocument {
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(source)
  if (!opening) throw new ServiceError('INVALID_FRONTMATTER', '缺少文件开头的 YAML frontmatter（---）。')
  const remaining = source.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/m.exec(remaining)
  if (!closing) throw new ServiceError('INVALID_FRONTMATTER', 'YAML frontmatter 未闭合。')
  let frontmatter: Record<string, unknown>
  try {
    const document = parseDocument(remaining.slice(0, closing.index), { schema: 'core', uniqueKeys: true, prettyErrors: true, strict: true })
    if (document.errors.length || document.warnings.length) throw new Error([...document.errors, ...document.warnings].map((e) => e.message).join('；'))
    const parsed: unknown = document.toJS({ maxAliasCount: 50 })
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('frontmatter 必须为键值对象')
    assertSafeData(parsed)
    frontmatter = parsed as Record<string, unknown>
  } catch (error) {
    throw new ServiceError('INVALID_FRONTMATTER', `YAML 无效：${error instanceof Error ? error.message : String(error)}`)
  }
  const issues: string[] = []
  const text = (name: string, required = false): string => {
    const value = frontmatter[name]
    if (value === undefined && !required) return ''
    if (typeof value !== 'string' || (required && !value.trim())) { issues.push(`${name} 必须是${required ? '非空' : ''}字符串`); return '' }
    return value
  }
  const strings = (name: string): string[] => {
    const value = frontmatter[name]
    if (value === undefined) return []
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) { issues.push(`${name} 必须是字符串数组`); return [] }
    return value as string[]
  }
  const published = parsePublished(frontmatter.published)
  if (published === null) issues.push('published 必须是有效日期（如 2026-10-09 或 2026-10-09 15:30:00）')
  let draft: boolean | null = null
  let top: number | null = null
  if (kind === 'post') {
    draft = frontmatter.draft === undefined ? false : typeof frontmatter.draft === 'boolean' ? frontmatter.draft : null
    if (draft === null) issues.push('draft 必须是布尔值')
    if (frontmatter.top !== undefined) {
      if (typeof frontmatter.top === 'number' && Number.isSafeInteger(frontmatter.top)) top = frontmatter.top
      else issues.push('top 必须是整数')
    }
    for (const field of ['cover', 'author', 'sourceLink', 'licenseName', 'licenseUrl']) text(field)
  } else if (frontmatter.draft !== undefined) issues.push('AI 日报 schema 不支持 draft；该字段不会作为草稿状态')
  return {
    article: {
      id: relativePath, relativePath, kind, extension: relativePath.toLowerCase().endsWith('.mdx') ? '.mdx' : '.md',
      title: text('title', true) || path.basename(relativePath, path.extname(relativePath)), published,
      category: kind === 'post' ? text('category') || null : null, tags: strings('tags'), draft,
      description: kind === 'post' ? text('description') : '', summary: kind === 'ai-daily' ? text('summary', true) : '',
      highlights: kind === 'ai-daily' ? strings('highlights') : [], tools: kind === 'ai-daily' ? strings('tools') : [],
      top, ...meta, issues,
    },
    source, body: remaining.slice(closing.index + closing[0].length), frontmatter,
    revision: createHash('sha256').update(source).digest('hex'),
  }
}
