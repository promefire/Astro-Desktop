import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, EllipsisVertical, FileText, Sparkles } from 'lucide-react'
import type { Article } from '../../../shared/contracts'
import { Badge, Button, cn } from './ui'

/**
 * 标题下方只写标签。正文和草稿的类型词由所在目录决定，列表视图已经说明当前范围，
 * 不在每行重复；没有标签时这一行整行省略，不补文件后缀，也不重复右侧的分类列。
 * AI 日报仍保留类型前缀，因为日报与文章混在「全部内容」里时需要区分。
 */
function detailText(article: Article, kindLabel: string): string {
  const tags = article.tags.join(' / ')
  if (article.kind === 'ai-daily') return [kindLabel, tags || article.extension.toUpperCase().slice(1)].join(' · ')
  return tags
}

export function ArticleListRow({ article, selected, menuOpen, kindLabel, statusLabel, dateLabel, onOpen, onToggleMenu, onDelete }: {
  article: Article
  selected: boolean
  menuOpen: boolean
  kindLabel: string
  statusLabel: string
  dateLabel: string
  onOpen(): void
  onToggleMenu(): void
  onDelete(): void
}) {
  const menuButton = useRef<HTMLButtonElement>(null)
  const detail = detailText(article, kindLabel)
  return <div className={cn('article-row', selected && 'is-selected')}>
    <button type="button" className="article-open" onClick={onOpen} aria-label={`查看文章：${article.title}`} aria-pressed={selected}>
      <span className="article-main"><span className={cn('article-icon', article.kind === 'ai-daily' && 'is-daily')}>{article.kind === 'ai-daily' ? <Sparkles size={17} /> : <FileText size={17} />}</span><span className="article-main-text"><span className="article-title" title={article.title}>{article.title}{article.issues.length > 0 && <AlertCircle size={13} className="issue-mark" />}</span>{detail && <span className="article-subtitle"><span className="article-detail" title={detail}>{detail}</span></span>}</span></span>
      <span className="date-cell">{dateLabel}</span>
      <span className="category-cell" title={article.category ?? ''}>{article.category ?? '未分类'}</span>
      <span><Badge tone={article.fileStatus === 'conflict' || article.issues.length ? 'warning' : article.fileStatus === 'clean' || article.fileStatus === 'unknown' ? 'neutral' : 'accent'}>{statusLabel}</Badge></span>
    </button>
    <Button ref={menuButton} type="button" size="icon" variant="ghost" className="article-menu-button" aria-label={`文章操作：${article.title}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={event => { event.stopPropagation(); onToggleMenu() }}><EllipsisVertical size={16} /></Button>
    {menuOpen && menuButton.current && <ArticleActionMenu anchor={menuButton.current} title={article.title} onDelete={onDelete} onClose={onToggleMenu} />}
  </div>
}

function ArticleActionMenu({ anchor, title, onDelete, onClose }: { anchor: HTMLButtonElement; title: string; onDelete(): void; onClose(): void }) {
  const menu = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const box = anchor.getBoundingClientRect()
  useEffect(() => {
    const item = menu.current?.querySelector('button')
    if (item instanceof HTMLButtonElement) item.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close.current() } }
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || anchor.contains(target) || menu.current?.contains(target)) return
      close.current()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer) }
  }, [anchor])
  return createPortal(<div ref={menu} className="article-menu" role="menu" aria-label={`文章操作：${title}`} style={{ top: box.bottom + 4, left: Math.max(8, box.right - 148) }}>
    <button type="button" role="menuitem" onClick={onDelete}>删除</button>
  </div>, document.body)
}
