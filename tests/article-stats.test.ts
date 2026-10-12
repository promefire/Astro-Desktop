import { describe, expect, it } from 'vitest'
import {
  countMatching, queryForCategory, queryForDaily, queryForDrafts, queryForPosts, queryForTag, queryForUntagged, summarize, type StatsArticle,
} from '../src/shared/article-stats'

function article(partial: Partial<StatsArticle> & Pick<StatsArticle, 'kind' | 'title'>): StatsArticle {
  return { category: null, tags: [], issues: [], relativePath: `${partial.title}.md`, ...partial }
}

describe('directory article statistics', () => {
  const longTag = '这是一个非常非常长的中文标签名称用于检查它不会被截断或合并'
  const articles: StatsArticle[] = [
    article({ kind: 'post', title: '甲', category: '前端', tags: ['Astro', 'Astro', longTag], issues: [] }),
    article({ kind: 'post', title: '乙', category: '前端', tags: ['astro'] }),
    article({ kind: 'draft', title: '丙', category: '生活', tags: [] }),
    article({ kind: 'draft', title: '丁', tags: ['Astro'] }),
    article({ kind: 'post', title: '带真草稿字段', category: '笔记', tags: ['笔记'] }),
    article({ kind: 'draft', title: '假非草稿', category: '前端', tags: ['Astro'] }),
    article({ kind: 'post', title: '戊', category: null, tags: ['笔记'], issues: ['category 必须是字符串'] }),
    article({ kind: 'draft', title: '己', category: '笔记', tags: [], issues: ['tags 必须是字符串数组'] }),
    article({ kind: 'post', title: '未分类同名', category: '未分类', tags: ['未分类'] }),
    article({ kind: 'ai-daily', title: '日报', category: null, tags: ['Astro'] }),
  ]
  const stats = summarize(articles, 2)

  it('counts the three directories and ignores the draft field', () => {
    expect(stats.posts).toBe(5)
    expect(stats.drafts).toBe(4)
    expect(stats.daily).toBe(1)
    expect(stats.scanFailures).toBe(2)
    expect(countMatching(articles, queryForPosts())).toBe(stats.posts)
    expect(countMatching(articles, queryForDrafts())).toBe(stats.drafts)
    expect(countMatching(articles, queryForDaily())).toBe(stats.daily)
    expect(articles.filter(item => countMatching([item], queryForPosts()) === 1).map(item => item.title)).not.toContain('丙')
    expect(articles.filter(item => countMatching([item], queryForDaily()) === 1).map(item => item.title)).toEqual(['日报'])
  })

  it('ranks posts and drafts without merging case or inventing an untagged tag', () => {
    expect(stats.categories.map(item => [item.name, item.count, item.missing])).toEqual([
      ['前端', 3, false],
      ['笔记', 2, false],
      ['生活', 1, false],
      ['未分类', 1, false],
      ['未分类', 1, true],
    ])
    expect(stats.tags.find(item => item.name === 'Astro')?.count).toBe(3)
    expect(stats.tags.find(item => item.name === 'astro')?.count).toBe(1)
    expect(stats.tags.find(item => item.name === longTag)?.count).toBe(1)
    expect(stats.tags.some(item => item.name === '无标签')).toBe(false)
    expect(stats.untagged).toBe(1)
    expect(stats.invalidCategory).toBe(1)
    expect(stats.invalidTags).toBe(1)
    expect(countMatching(articles, queryForCategory(stats.categories[0]))).toBe(3)
    const missing = stats.categories.find(item => item.missing)!
    expect(countMatching(articles, queryForCategory(missing))).toBe(1)
    expect(articles.filter(item => countMatching([item], queryForCategory(missing)) === 1).map(item => item.title)).toEqual(['丁'])
    expect(countMatching(articles, queryForTag('Astro'))).toBe(3)
    expect(countMatching(articles, queryForTag('astro'))).toBe(1)
    expect(countMatching(articles, queryForUntagged())).toBe(1)
    expect(articles.filter(item => countMatching([item], queryForUntagged()) === 1).map(item => item.title)).toEqual(['丙'])
  })

  it('sorts equal counts by name and reports an empty project', () => {
    const tied = summarize([
      article({ kind: 'post', title: '一', category: '生活' }),
      article({ kind: 'draft', title: '二', category: '技术' }),
    ])
    expect(tied.categories.map(item => item.name)).toEqual(['技术', '生活'])
    const empty = summarize([], 1)
    expect(empty.posts).toBe(0)
    expect(empty.categories).toEqual([])
    expect(empty.tags).toEqual([])
    expect(empty.scanFailures).toBe(1)
  })
})
