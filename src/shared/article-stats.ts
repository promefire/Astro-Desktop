import type { Article, ContentKind } from './contracts'

export interface StatsArticle {
  kind: ContentKind
  category: string | null
  tags: string[]
  issues: string[]
  title?: string
  relativePath?: string
}
export type LibraryView = 'all' | 'posts' | 'drafts' | 'daily' | 'writing'
export type CategoryFilter = { type: 'all' } | { type: 'name'; name: string } | { type: 'missing' }
export type TagFilter = { type: 'all' } | { type: 'name'; name: string } | { type: 'untagged' }
export interface LibraryQuery { view: LibraryView; category: CategoryFilter; tag: TagFilter }
export interface RankItem { name: string; count: number; missing: boolean }
export interface ArticleStats {
  posts: number
  drafts: number
  daily: number
  untagged: number
  invalidCategory: number
  invalidTags: number
  scanFailures: number
  rankedArticles: number
  categories: RankItem[]
  tags: RankItem[]
}

const CATEGORY_ISSUE = 'category 必须是字符串'
const TAGS_ISSUE = 'tags 必须是字符串数组'
const ALL_CATEGORY: CategoryFilter = { type: 'all' }
const ALL_TAG: TagFilter = { type: 'all' }

export function isInvalidCategory(article: StatsArticle): boolean {
  return (article.kind === 'post' || article.kind === 'draft') && article.issues.includes(CATEGORY_ISSUE)
}
export function isInvalidTags(article: StatsArticle): boolean {
  return (article.kind === 'post' || article.kind === 'draft') && article.issues.includes(TAGS_ISSUE)
}
export function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags)]
}
function ranked(article: StatsArticle): boolean {
  return article.kind === 'post' || article.kind === 'draft'
}
function compareRank(left: RankItem, right: RankItem): number {
  if (right.count !== left.count) return right.count - left.count
  const byName = left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'variant', numeric: true })
  if (byName) return byName
  if (left.name < right.name) return -1
  if (left.name > right.name) return 1
  if (left.missing !== right.missing) return left.missing ? 1 : -1
  return 0
}

export function summarize(articles: readonly StatsArticle[], scanFailures = 0): ArticleStats {
  const stats: ArticleStats = {
    posts: 0, drafts: 0, daily: 0, untagged: 0, invalidCategory: 0, invalidTags: 0,
    scanFailures, rankedArticles: 0, categories: [], tags: [],
  }
  const categories = new Map<string, RankItem>()
  const tags = new Map<string, RankItem>()
  for (const article of articles) {
    if (article.kind === 'post') stats.posts += 1
    else if (article.kind === 'draft') stats.drafts += 1
    else stats.daily += 1
    if (!ranked(article)) continue
    stats.rankedArticles += 1
    if (isInvalidCategory(article)) stats.invalidCategory += 1
    else if (article.category) {
      const current = categories.get(`name:${article.category}`) ?? { name: article.category, count: 0, missing: false }
      current.count += 1
      categories.set(`name:${article.category}`, current)
    } else {
      const current = categories.get('missing') ?? { name: '未分类', count: 0, missing: true }
      current.count += 1
      categories.set('missing', current)
    }
    if (isInvalidTags(article)) stats.invalidTags += 1
    else {
      const names = uniqueTags(article.tags)
      if (names.length === 0) stats.untagged += 1
      for (const name of names) {
        const current = tags.get(name) ?? { name, count: 0, missing: false }
        current.count += 1
        tags.set(name, current)
      }
    }
  }
  stats.categories = [...categories.values()].sort(compareRank)
  stats.tags = [...tags.values()].sort(compareRank)
  return stats
}

export function matchesArticle(article: StatsArticle, query: LibraryQuery): boolean {
  if (query.view === 'posts' && article.kind !== 'post') return false
  if (query.view === 'drafts' && article.kind !== 'draft') return false
  if (query.view === 'daily' && article.kind !== 'ai-daily') return false
  if (query.view === 'writing' && !ranked(article)) return false
  if (query.category.type === 'name' && (isInvalidCategory(article) || article.category !== query.category.name)) return false
  if (query.category.type === 'missing' && (!ranked(article) || isInvalidCategory(article) || !!article.category)) return false
  if (query.tag.type === 'name' && (isInvalidTags(article) || !uniqueTags(article.tags).includes(query.tag.name))) return false
  if (query.tag.type === 'untagged' && (!ranked(article) || isInvalidTags(article) || uniqueTags(article.tags).length > 0)) return false
  return true
}

export function countMatching(articles: readonly StatsArticle[], query: LibraryQuery): number {
  return articles.filter(article => matchesArticle(article, query)).length
}

export function queryForPosts(): LibraryQuery { return { view: 'posts', category: ALL_CATEGORY, tag: ALL_TAG } }
export function queryForDrafts(): LibraryQuery { return { view: 'drafts', category: ALL_CATEGORY, tag: ALL_TAG } }
export function queryForDaily(): LibraryQuery { return { view: 'daily', category: ALL_CATEGORY, tag: ALL_TAG } }
export function queryForCategory(item: RankItem): LibraryQuery {
  return { view: 'writing', category: item.missing ? { type: 'missing' } : { type: 'name', name: item.name }, tag: ALL_TAG }
}
export function queryForTag(name: string): LibraryQuery {
  return { view: 'writing', category: ALL_CATEGORY, tag: { type: 'name', name } }
}
export function queryForUntagged(): LibraryQuery {
  return { view: 'writing', category: ALL_CATEGORY, tag: { type: 'untagged' } }
}

export function categorySelectValue(filter: CategoryFilter): string {
  if (filter.type === 'missing') return 'missing'
  if (filter.type === 'name') return `name:${encodeURIComponent(filter.name)}`
  return ''
}
export function categoryFromSelect(value: string): CategoryFilter {
  if (value === 'missing') return { type: 'missing' }
  if (value.startsWith('name:')) return { type: 'name', name: decodeURIComponent(value.slice(5)) }
  return { type: 'all' }
}
export function tagSelectValue(filter: TagFilter): string {
  if (filter.type === 'untagged') return 'untagged'
  if (filter.type === 'name') return `name:${encodeURIComponent(filter.name)}`
  return ''
}
export function tagFromSelect(value: string): TagFilter {
  if (value === 'untagged') return { type: 'untagged' }
  if (value.startsWith('name:')) return { type: 'name', name: decodeURIComponent(value.slice(5)) }
  return { type: 'all' }
}
export function asStatsArticle(article: Article): StatsArticle { return article }
