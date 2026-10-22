import { parseDocument } from 'yaml'
import type { Article, ContentKind } from '../../../shared/contracts'

export interface MetadataValues {
  title: string
  published: string
  category: string
  tags: string[]
  description: string
  summary: string
  highlights: string[]
  tools: string[]
  top: string
  cover: string
}

function setOrDelete(document: ReturnType<typeof parseDocument>, key: string, value: unknown, required = false): void {
  if (required || (typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.length > 0 : value !== '')) document.set(key, value)
  else document.delete(key)
}

function frontmatterBody(block: string): { prefix: string; yaml: string; suffix: string } {
  const bom = block.startsWith('\uFEFF') ? '\uFEFF' : ''
  const content = block.slice(bom.length)
  const opening = /^---[\t ]*(\r\n|\n|\r)/.exec(content)
  if (!opening) throw new Error('文章缺少可编辑的 Frontmatter。')
  const remaining = content.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[\t ]*(?:(?:\r\n|\n|\r)|$)/m.exec(remaining)
  if (!closing) throw new Error('YAML Frontmatter 未闭合。')
  return {
    prefix: bom + opening[0],
    yaml: remaining.slice(0, closing.index),
    suffix: remaining.slice(closing.index),
  }
}

export function metadataFromArticle(article: Article): MetadataValues {
  return {
    title: article.title,
    published: article.published?.slice(0, 10) ?? '',
    category: article.category ?? '',
    tags: [...article.tags],
    description: article.description,
    summary: article.summary,
    highlights: [...article.highlights],
    tools: [...article.tools],
    top: article.top === null ? '' : String(article.top), cover: '',
  }
}

export function metadataFromDocument(article: Article, frontmatter: Record<string, unknown>): MetadataValues {
  const list = (key: keyof MetadataValues) => Array.isArray(frontmatter[key]) ? (frontmatter[key] as unknown[]).filter((item): item is string => typeof item === 'string') : []
  return {
    ...metadataFromArticle(article),
    highlights: list('highlights'), tools: list('tools'),
    cover: typeof frontmatter.cover === 'string' ? frontmatter.cover : '',
    top: typeof frontmatter.top === 'number' && Number.isSafeInteger(frontmatter.top) ? String(frontmatter.top) : '',
  }
}

/** Update only supported fields through YAML's document model; unknown keys/comments survive. */
export function updateFrontmatter(block: string, kind: ContentKind, values: MetadataValues): string {
  const parts = frontmatterBody(block)
  const document = parseDocument(parts.yaml, { schema: 'core', uniqueKeys: true })
  if (document.errors.length) throw new Error(document.errors[0].message)

  setOrDelete(document, 'title', values.title, true)
  setOrDelete(document, 'published', values.published, true)
  setOrDelete(document, 'tags', values.tags)
  // `draft` is not an Astro Desktop field. Collection membership is determined by directory.
  document.delete('draft')

  if (kind === 'ai-daily') {
    setOrDelete(document, 'summary', values.summary, true)
    setOrDelete(document, 'highlights', values.highlights)
    setOrDelete(document, 'tools', values.tools)
  } else {
    setOrDelete(document, 'category', values.category)
    setOrDelete(document, 'description', values.description)
    if (values.top.trim()) {
      const top = Number(values.top)
      if (!Number.isSafeInteger(top)) throw new Error('置顶序号必须是整数。')
      document.set('top', top)
    } else document.delete('top')
    setOrDelete(document, 'cover', values.cover)
  }
  return parts.prefix + document.toString({ lineWidth: 0 }) + parts.suffix
}
