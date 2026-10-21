import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { ScanIssue } from '../../../shared/contracts'
import { queryForCategory, queryForDaily, queryForDrafts, queryForPosts, queryForTag, queryForUntagged, type ArticleStats, type LibraryQuery, type RankItem } from '../../../shared/article-stats'
import { Button, Input } from './ui'

const PAGE_SIZE = 8

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function StatsView({ projectName, projectPath, scannedAt, stats, issues, busy, onOpen }: {
  projectName: string
  projectPath: string
  scannedAt: string
  stats: ArticleStats
  issues: ScanIssue[]
  busy: boolean
  onOpen(query: LibraryQuery): void
}) {
  const empty = stats.posts + stats.drafts + stats.daily === 0 && issues.length === 0
  return <section className="stats-page" aria-label="文章统计">
    <div className="library-heading"><div><h1>文章统计</h1></div></div>
    <p className="stats-meta"><span>{projectName}</span><span title={projectPath}>{projectPath}</span>{scannedAt && <span>更新于 {formatTime(scannedAt)}</span>}</p>
    {busy && !scannedAt ? <p className="stats-note">正在读取文章索引…</p> : empty ? <p className="stats-note">这个项目还没有读到正文、草稿或 AI 日报。</p> : <>
      <div className="stats-counts">
        <button type="button" className="stats-count" onClick={() => onOpen(queryForPosts())} aria-label={`查看正文，${stats.posts} 篇`}><span>正文</span><strong>{stats.posts}</strong><small>src/contents/post，不表示已发布</small></button>
        <button type="button" className="stats-count" onClick={() => onOpen(queryForDrafts())} aria-label={`查看草稿，${stats.drafts} 篇`}><span>草稿</span><strong>{stats.drafts}</strong><small>src/contents/drafts</small></button>
        <button type="button" className="stats-count" onClick={() => onOpen(queryForDaily())} aria-label={`查看 AI 日报，${stats.daily} 篇`}><span>AI 日报</span><strong>{stats.daily}</strong><small>src/contents/ai-daily</small></button>
      </div>
      <p className="stats-scope">分类和标签只统计正文与草稿，共 {stats.rankedArticles} 篇，不含 AI 日报。无标签 {stats.untagged} 篇，不进入标签排行。</p>
      {stats.untagged > 0 && <button type="button" className="stats-link" onClick={() => onOpen(queryForUntagged())}>查看无标签的正文和草稿</button>}
      <div className="stats-boards">
        <Ranking title="分类排行" noun="分类" items={stats.categories} empty="没有可排行的分类。" onOpen={item => onOpen(queryForCategory(item))} />
        <Ranking title="标签排行" noun="标签" items={stats.tags} empty="没有可排行的标签。" onOpen={item => onOpen(queryForTag(item.name))} />
      </div>
    </>}
    {(issues.length > 0 || stats.invalidCategory > 0 || stats.invalidTags > 0) && <div className="stats-exceptions" role="status">
      <strong>未完整计入的内容</strong>
      {issues.length > 0 && <p>读取失败 {issues.length} 项，没有进入上面的数量和排行。</p>}
      {issues.slice(0, 8).map(issue => <p key={`${issue.path}:${issue.message}`}><code>{issue.path}</code> {issue.message}</p>)}
      {issues.length > 8 && <p>其余 {issues.length - 8} 项可在项目设置中查看。</p>}
      {stats.invalidCategory > 0 && <p>{stats.invalidCategory} 篇正文或草稿的 category 不是字符串，未计入分类排行，也没有算作未分类。</p>}
      {stats.invalidTags > 0 && <p>{stats.invalidTags} 篇正文或草稿的 tags 不是字符串数组，未计入标签排行，也没有算作无标签。</p>}
    </div>}
  </section>
}

function Ranking({ title, noun, items, empty, onOpen }: { title: string; noun: string; items: RankItem[]; empty: string; onOpen(item: RankItem): void }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const visible = useMemo(() => items.filter(item => item.name.includes(query.trim())), [items, query])
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  useEffect(() => { setPage(1) }, [query, items])
  const slice = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const max = Math.max(1, ...items.map(item => item.count))
  return <section className="stats-board" aria-label={title}>
    <div className="stats-board-heading"><h2>{title}</h2><span>共 {items.length} 项</span></div>
    <div className="search-input"><Search size={15} /><Input type="search" aria-label={`搜索${noun}`} placeholder={`搜索${noun}`} value={query} onChange={event => setQuery(event.target.value)} /></div>
    {items.length === 0 ? <p className="stats-note">{empty}</p> : visible.length === 0 ? <p className="stats-note">没有匹配的{noun}。清除搜索可查看全部 {items.length} 项。</p> : <div className="stats-ranks">
      {slice.map(item => <button type="button" key={`${item.missing ? 'missing' : 'name'}:${item.name}`} className="stats-rank" onClick={() => onOpen(item)} aria-label={`${noun} ${item.missing ? '未分类，没有填写 category' : item.name}，${item.count} 篇`}>
        <span className="stats-rank-label" title={item.missing ? '没有填写 category' : item.name}>{item.missing ? '未分类' : item.name || '（空白名称）'}{noun === '分类' && !item.missing && item.name === '未分类' ? '（分类名称）' : ''}</span>
        <span className="stats-rank-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round(item.count / max * 100))}%` }} /></span>
        <span className="stats-rank-count">{item.count}</span>
      </button>)}
    </div>}
    {visible.length > PAGE_SIZE && <div className="stats-pager"><span>第 {current} / {pages} 页，共 {visible.length} 项</span><div><Button size="icon" variant="ghost" aria-label={`上一页${noun}`} disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></Button><Button size="icon" variant="ghost" aria-label={`下一页${noun}`} disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></Button></div></div>}
  </section>
}
