import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle, ArrowDownUp, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, Code2, File, FileText, Folder, FolderOpen, GitBranch, Layers3,
  LoaderCircle, Monitor, Moon, PanelRightClose, PanelRightOpen, RefreshCw, Search,
  Settings2, Sparkles, Sun, Tag, Trash2, X, Plus,
} from 'lucide-react'
import type { AppSettings, Article, ArticleDocument, ContentIndex, CreateDraftInput, DesktopApi, FileStatus, ProjectInfo, Result, Theme } from '../../shared/contracts'
import { Badge, Button, Input, cn } from './components/ui'
import { CreateDraftDialog } from './components/CreateDraftDialog'

const EMPTY_SETTINGS: AppSettings = { version: 1, theme: 'system', recentProjects: [], lastProjectPath: null }
const EMPTY_INDEX: ContentIndex = { articles: [], issues: [], scannedAt: '' }
const PAGE_SIZE = 12
type LibraryView = 'all' | 'posts' | 'drafts' | 'daily'
type SortOrder = 'published-desc' | 'published-asc' | 'modified-desc' | 'title'
const viewLabels: Record<LibraryView, string> = { all: '全部内容', posts: '普通文章', drafts: '草稿', daily: 'AI 日报' }
const statusLabels: Record<FileStatus, string> = { clean: '无改动', modified: '已修改', added: '已暂存新增', untracked: '未跟踪', conflict: '存在冲突', ignored: '已忽略', unknown: '状态未知' }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '操作未完成，请重试。' }
async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}
function dateLabel(value: string | null, withTime = false): string {
  if (!value) return '未设置'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return withTime
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : value.slice(0, 10)
}
function byteLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB` }
function matchesView(article: Article, view: LibraryView) {
  return view === 'all' || (view === 'posts' && article.kind === 'post') || (view === 'drafts' && article.kind === 'post' && article.draft === true) || (view === 'daily' && article.kind === 'ai-daily')
}

function App() {
  const api = window.astroDesktop
  const navigate = useNavigate()
  const location = useLocation()
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [index, setIndex] = useState<ContentIndex>(EMPTY_INDEX)
  const [initializing, setInitializing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [themeBusy, setThemeBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdNotice, setCreatedNotice] = useState<string | null>(null)
  const pendingCreatedPath = useRef<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [document, setDocument] = useState<ArticleDocument | null>(null)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'properties' | 'source'>('properties')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<SortOrder>('published-desc')
  const [page, setPage] = useState(1)
  const operationId = useRef(0)
  const readId = useRef(0)
  const busyRef = useRef(false)
  const selectedRef = useRef<string | null>(null)

  const rawView = location.pathname.split('/')[2]
  const view: LibraryView = rawView && Object.hasOwn(viewLabels, rawView) ? rawView as LibraryView : 'all'
  const isSettings = location.pathname === '/settings'
  const isProjects = location.pathname === '/projects'

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { window.document.documentElement.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  const selectArticle = useCallback((path: string | null) => {
    if (selectedRef.current === path) return
    readId.current += 1
    selectedRef.current = path
    setSelectedPath(path)
    setDocument(null)
    setDocumentError(null)
    setDocumentLoading(!!path)
  }, [])

  const applyIndex = useCallback((nextIndex: ContentIndex, keepSelection: boolean) => {
    setIndex(nextIndex)
    const retained = keepSelection && nextIndex.articles.some(article => article.relativePath === selectedRef.current)
    selectArticle(retained ? selectedRef.current : null)
  }, [selectArticle])

  useEffect(() => {
    if (!api) { setInitializing(false); return }
    let disposed = false
    const token = ++operationId.current
    const initialize = async () => {
      try {
        const [nextSettings, currentProject] = await Promise.all([unwrap(api.getSettings()), unwrap(api.getProject())])
        if (disposed) return
        setSettings(nextSettings)
        const nextProject = currentProject ?? (nextSettings.lastProjectPath ? await unwrap(api.openRecentProject(nextSettings.lastProjectPath)) : null)
        if (disposed || token !== operationId.current) return
        if (nextProject) {
          setProject(nextProject)
          const nextIndex = await unwrap(api.listArticles())
          if (!disposed && token === operationId.current) applyIndex(nextIndex, false)
        }
      } catch (cause) {
        if (!disposed) setError(errorMessage(cause))
      } finally {
        if (!disposed) setInitializing(false)
      }
    }
    void initialize()
    return () => { disposed = true }
  }, [api, applyIndex])

  // Each request belongs to one project operation and one selection; old responses
  // cannot replace the document after navigation, a refresh, or project switching.
  useEffect(() => {
    if (!api || !selectedPath || busy) return
    const token = ++readId.current
    const projectToken = operationId.current
    setDocumentLoading(true)
    setDocumentError(null)
    void unwrap(api.readArticle(selectedPath)).then(nextDocument => {
      if (token === readId.current && projectToken === operationId.current) setDocument(nextDocument)
    }).catch(cause => {
      if (token === readId.current && projectToken === operationId.current) setDocumentError(errorMessage(cause))
    }).finally(() => {
      if (token === readId.current && projectToken === operationId.current) setDocumentLoading(false)
    })
    return () => { readId.current += 1 }
  }, [api, selectedPath, busy, index.scannedAt])

  const openProject = async (path?: string) => {
    if (!api || busyRef.current || initializing) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const token = ++operationId.current
    readId.current += 1
    try {
      const nextProject = path ? await unwrap(api.openRecentProject(path)) : await unwrap(api.selectProject())
      if (!nextProject || token !== operationId.current) return
      setProject(nextProject)
      setCreatedNotice(null)
      setIndex(EMPTY_INDEX)
      selectArticle(null)
      setSearch(''); setCategory(''); setTag(''); setPage(1)
      navigate('/library/all')
      const nextIndex = await unwrap(api.listArticles())
      if (token !== operationId.current) return
      applyIndex(nextIndex, false)
      setSettings(await unwrap(api.getSettings()))
    } catch (cause) { if (token === operationId.current) setError(errorMessage(cause)) }
    finally { if (token === operationId.current) { setBusy(false); busyRef.current = false } }
  }

  const refresh = async () => {
    if (!api || !project || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const token = ++operationId.current
    readId.current += 1
    setDocument(null)
    try {
      const nextProject = await unwrap(api.refreshProject())
      if (token !== operationId.current) return
      setProject(nextProject)
      const nextIndex = await unwrap(api.listArticles())
      if (token === operationId.current) applyIndex(nextIndex, true)
    } catch (cause) { if (token === operationId.current) setError(errorMessage(cause)) }
    finally { if (token === operationId.current) { setBusy(false); busyRef.current = false } }
  }

  const runAction = async (action: (desktop: DesktopApi) => Promise<Result<unknown>>) => {
    if (!api) return
    try { await unwrap(action(api)) } catch (cause) { setError(errorMessage(cause)) }
  }

  const createDraft = async (fields: Omit<CreateDraftInput, 'projectPath'>) => {
    if (!api || !project || busyRef.current) throw new Error('项目正在处理其他操作，请稍后重试。')
    busyRef.current = true
    setBusy(true)
    readId.current += 1
    try {
      const created = await unwrap(api.createDraft({ ...fields, projectPath: project.path }))
      selectArticle(null)
      setSearch(''); setCategory(''); setTag(''); setPage(1); setSort('modified-desc')
      setIndex(current => ({ ...current, articles: [created.article, ...current.articles], scannedAt: new Date().toISOString() }))
      if (view === 'drafts') selectArticle(created.article.relativePath)
      else pendingCreatedPath.current = created.article.relativePath
      navigate('/library/drafts')
      setInspectorOpen(true)
      setDetailTab('properties')
      setCreatedNotice(`草稿已创建：${created.article.relativePath}`)
      setError(null)
      setCreateOpen(false)
    } finally { setBusy(false); busyRef.current = false }
  }

  const changeTheme = async (theme: Theme) => {
    if (!api || themeBusy) return
    setThemeBusy(true)
    try { setSettings(await unwrap(api.setTheme(theme))) } catch (cause) { setError(errorMessage(cause)) }
    finally { setThemeBusy(false) }
  }

  const forgetProject = async (path: string) => {
    if (!api || busyRef.current) return
    try { setSettings(await unwrap(api.forgetProject(path))) } catch (cause) { setError(errorMessage(cause)) }
  }

  const viewArticles = useMemo(() => index.articles.filter(article => matchesView(article, view)), [index.articles, view])
  const categories = useMemo(() => Array.from(new Set(viewArticles.map(article => article.category).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [viewArticles])
  const tags = useMemo(() => Array.from(new Set(viewArticles.flatMap(article => article.tags))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [viewArticles])
  const filtered = useMemo(() => {
    const query = search.toLocaleLowerCase().trim()
    return viewArticles.filter(article => (!query || `${article.title}\n${article.relativePath}`.toLocaleLowerCase().includes(query)) && (!category || article.category === category) && (!tag || article.tags.includes(tag))).sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sort === 'modified-desc') return b.modifiedAt.localeCompare(a.modifiedAt)
      const comparison = (a.published ?? '').localeCompare(b.published ?? '')
      return sort === 'published-asc' ? comparison : -comparison
    })
  }, [viewArticles, search, category, tag, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageArticles = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const selectedArticle = index.articles.find(article => article.relativePath === selectedPath) ?? null
  const counts = useMemo(() => ({ all: index.articles.length, posts: index.articles.filter(article => article.kind === 'post').length, drafts: index.articles.filter(article => article.kind === 'post' && article.draft).length, daily: index.articles.filter(article => article.kind === 'ai-daily').length }), [index.articles])

  useEffect(() => { setPage(1) }, [view, search, category, tag, sort])
  useEffect(() => {
    setCategory(''); setTag('')
    selectArticle(view === 'drafts' ? pendingCreatedPath.current : null)
    pendingCreatedPath.current = null
  }, [view, selectArticle])
  useEffect(() => {
    if (selectedPath && !filtered.some(article => article.relativePath === selectedPath)) selectArticle(null)
  }, [filtered, selectedPath, selectArticle])

  const busyAll = busy || initializing
  const showWelcome = !project || isProjects
  const navItems = [
    { view: 'all' as const, icon: Layers3 }, { view: 'posts' as const, icon: FileText },
    { view: 'drafts' as const, icon: File }, { view: 'daily' as const, icon: Sparkles },
  ]

  return <div className="app-shell">
    <aside className="sidebar" aria-label="主导航">
      <div className="brand"><div className="brand-symbol"><Sparkles size={22} strokeWidth={1.8} /></div><div><strong>Astro<span> Desktop</span></strong><small>本地博客工作台</small></div></div>
      <NavLink to="/projects" className={cn('project-switcher', isProjects && 'is-active')}>
        <span className="project-avatar"><Folder size={18} /></span>
        <span className="project-switcher-text"><strong>{project?.name ?? '选择博客项目'}</strong><small>{project ? '本地项目' : '连接你的内容'}</small></span>
        <ChevronRight size={15} />
      </NavLink>
      <div className="nav-group-label">内容库</div>
      <nav className="main-nav">
        {navItems.map(({ view: item, icon: Icon }) => <NavLink key={item} to={`/library/${item}`} className={cn('nav-item', !isSettings && !isProjects && view === item && 'is-active')}><Icon size={17} /><span>{viewLabels[item]}</span><span className="nav-count">{project ? counts[item] : '·'}</span></NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/settings" className={({ isActive }) => cn('nav-item', isActive && 'is-active')}><Settings2 size={17} /><span>项目设置</span></NavLink>
        <div className="sidebar-caption"><span>本地文件 · 直接读取</span><Button size="icon" variant="ghost" aria-label={settings.theme === 'dark' ? '切换浅色主题' : '切换深色主题'} title={settings.theme === 'dark' ? '切换浅色主题' : '切换深色主题'} disabled={!api || themeBusy} onClick={() => void changeTheme(settings.theme === 'dark' ? 'light' : 'dark')}>{settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</Button></div>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="project-context"><FolderOpen size={16} /><span title={project?.path}>{project?.name ?? '工作空间'}</span>{project && <><span className="context-divider">/</span><span className="branch" title={project.git.error ?? '本地 Git 分支'}><GitBranch size={14} />{project.git.branch ?? (project.git.isRepository ? '游离 HEAD' : '非 Git 仓库')}</span></>}</div>
        <div className="topbar-actions">{project && <Button size="small" variant="ghost" disabled={busyAll} onClick={() => void refresh()} aria-label="刷新文章"><RefreshCw size={15} className={busy ? 'spin' : ''} /><span>刷新</span></Button>}<Button size="small" disabled={!api || busyAll} onClick={() => void openProject()}><FolderOpen size={15} />打开项目</Button></div>
      </header>

      {error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{error}</span><Button size="icon" variant="ghost" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={15} /></Button></div>}
      {createdNotice && <div className="created-banner" role="status"><Check size={17} /><span>{createdNotice}</span><Button size="icon" variant="ghost" aria-label="关闭创建提示" onClick={() => setCreatedNotice(null)}><X size={15} /></Button></div>}

      {!api ? <main className="welcome-content"><EmptyState icon={<Monitor size={32} />} title="请在 Astro Desktop 中打开" description="本地文件系统与目录选择需要 Electron 桌面环境。请在项目目录运行 npm run dev 启动桌面应用。" /></main>
        : initializing ? <main className="welcome-content"><EmptyState icon={<LoaderCircle size={28} className="spin" />} title="正在打开工作空间" description="读取本地设置与文章索引…" /></main>
          : isSettings ? <SettingsView project={project} settings={settings} themeBusy={themeBusy} onTheme={changeTheme} onOpenFolder={() => void runAction(desktop => desktop.openProjectFolder())} issues={index.issues} onOpenProject={() => void openProject()} busy={busy} />
            : showWelcome ? <WelcomeView settings={settings} project={project} busy={busy} onOpen={() => void openProject()} onRecent={path => void openProject(path)} onForget={path => void forgetProject(path)} onContinue={() => navigate('/library/all')} />
              : <main className="library-layout">
                <section className="library" aria-label="文章库">
                  <div className="library-heading"><div><div className="heading-overline">内容管理</div><h1>{viewLabels[view]} <span>{viewArticles.length}</span></h1><p>{view === 'daily' ? '独立读取 AI 日报 collection 的内容与字段。' : view === 'drafts' ? '普通文章中标记为 draft: true 的本地内容。' : '从你的 Astro 项目读取 Markdown 与 MDX。'}</p></div><Button size="icon" variant="ghost" onClick={() => setInspectorOpen(!inspectorOpen)} aria-label={inspectorOpen ? '收起文章详情' : '显示文章详情'} title={inspectorOpen ? '收起文章详情' : '显示文章详情'}>{inspectorOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</Button></div>
                  <div className="library-toolbar">
                    {view !== 'daily' && <Button variant="primary" disabled={busyAll} onClick={() => setCreateOpen(true)}><Plus size={16} />新建文章</Button>}
                    <div className="search-input"><Search size={16} /><Input type="search" placeholder="搜索标题或文件名…" aria-label="搜索文章" value={search} onChange={event => setSearch(event.target.value)} /></div>
                    <label className="sort-select"><ArrowDownUp size={14} /><select aria-label="文章排序" value={sort} onChange={event => setSort(event.target.value as SortOrder)}><option value="published-desc">日期从新到旧</option><option value="published-asc">日期从旧到新</option><option value="modified-desc">最近修改</option><option value="title">标题排序</option></select></label>
                  </div>
                  <div className="filter-toolbar"><label className="filter-select"><Folder size={14} /><select aria-label="按分类筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="filter-select"><Tag size={14} /><select aria-label="按标签筛选" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(value => <option key={value} value={value}>{value}</option>)}</select></label>{(search || category || tag) && <Button size="small" variant="ghost" onClick={() => { setSearch(''); setCategory(''); setTag('') }}>清除筛选</Button>}<span className="filter-total">{filtered.length} 篇内容</span></div>
                  {index.issues.length > 0 && <button className="scan-warning" onClick={() => navigate('/settings')}><AlertCircle size={15} /><span>读取时发现 {index.issues.length} 项问题，查看详情</span><ChevronRight size={14} /></button>}
                  <div className="article-table" aria-busy={busy}>
                    <div className="table-head"><span>文章</span><span>日期</span><span className="category-cell">分类</span><span>本地状态</span></div>
                    <div className="table-body">
                      {busy ? <EmptyState compact icon={<LoaderCircle size={25} className="spin" />} title="正在读取文章" description="扫描本地文件与 Git 状态…" /> : pageArticles.length === 0 ? <EmptyState compact icon={<Search size={26} />} title={search || category || tag ? '没有匹配的内容' : '这里还没有内容'} description={search || category || tag ? '试试其他关键词，或清除当前筛选条件。' : '此内容目录没有可读取的文章，添加文件后点击刷新。'} /> : pageArticles.map(article => <button key={article.id} className={cn('article-row', selectedPath === article.relativePath && 'is-selected')} onClick={() => { selectArticle(article.relativePath); setInspectorOpen(true) }} aria-label={`查看文章：${article.title}`} aria-pressed={selectedPath === article.relativePath}>
                        <div className="article-main"><span className={cn('article-icon', article.kind === 'ai-daily' && 'is-daily')}>{article.kind === 'ai-daily' ? <Sparkles size={17} /> : <FileText size={17} />}</span><span className="article-main-text"><span className="article-title" title={article.title}>{article.title}{article.issues.length > 0 && <AlertCircle size={13} className="issue-mark" />}</span><span className="article-subtitle"><span>{article.kind === 'ai-daily' ? 'AI 日报' : article.draft ? '草稿' : '普通文章'}</span><span className="subtitle-separator">·</span><span className="article-tags">{article.tags.length ? article.tags.join(' / ') : article.extension.toUpperCase().slice(1)}</span></span></span></div>
                        <span className="date-cell">{dateLabel(article.published)}</span><span className="category-cell" title={article.category ?? ''}>{article.category ?? '未分类'}</span><span><Badge tone={article.fileStatus === 'conflict' || article.issues.length ? 'warning' : article.fileStatus === 'clean' || article.fileStatus === 'unknown' ? 'neutral' : 'accent'}>{statusLabels[article.fileStatus]}</Badge></span>
                      </button>)}
                    </div>
                  </div>
                  <div className="pagination"><span>{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)}` : '0'} / {filtered.length} 篇</span><div><Button size="icon" variant="ghost" aria-label="上一页" disabled={currentPage <= 1 || busy} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><span>{currentPage} / {totalPages}</span><Button size="icon" variant="ghost" aria-label="下一页" disabled={currentPage >= totalPages || busy} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
                </section>
                {inspectorOpen && <ArticleInspector article={selectedArticle} document={document} loading={documentLoading || busy} error={documentError} tab={detailTab} onTab={setDetailTab} onReveal={() => selectedPath && void runAction(desktop => desktop.revealArticle(selectedPath))} />}
              </main>}

      <footer className="statusbar"><div><span className={cn('status-dot', project && 'is-connected')} /><span>{busyAll ? '正在处理本地项目…' : project ? '已连接本地项目' : '尚未连接项目'}</span>{project && <span className="status-path" title={project.path}>{project.path}</span>}</div><div>{index.scannedAt && <span>更新于 {new Date(index.scannedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}<span>本地内容</span></div></footer>
    </div>
    {createOpen && project && <CreateDraftDialog categories={[...new Set(index.articles.filter(article => article.kind === 'post').map(article => article.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'zh-CN'))} availableTags={[...new Set(index.articles.filter(article => article.kind === 'post').flatMap(article => article.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))} onCreate={createDraft} onClose={() => setCreateOpen(false)} />}
  </div>
}

function EmptyState({ icon, title, description, compact = false }: { icon: ReactNode; title: string; description: string; compact?: boolean }) {
  return <div className={cn('empty-state', compact && 'empty-state-compact')}><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p></div>
}

function WelcomeView({ settings, project, busy, onOpen, onRecent, onForget, onContinue }: { settings: AppSettings; project: ProjectInfo | null; busy: boolean; onOpen: () => void; onRecent: (path: string) => void; onForget: (path: string) => void; onContinue: () => void }) {
  return <main className="welcome-content"><div className="welcome-inner"><div className="welcome-emblem"><BookOpen size={31} strokeWidth={1.5} /><span><Sparkles size={17} /></span></div><h1>你的文字，<br />从这里继续。</h1><p className="welcome-intro">连接本地 Astro 博客，浏览文章与 AI 日报。<br />每一篇内容，都来自你自己的文件。</p><div className="welcome-actions"><Button variant="primary" onClick={onOpen} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <FolderOpen size={17} />}选择博客目录</Button>{project && <Button onClick={onContinue}>返回内容库<ArrowUpRight size={15} /></Button>}</div><p className="welcome-hint">支持 promefire/Astro_Blog 的内容目录结构</p>
    <section className="recent-projects" aria-label="最近项目"><div className="recent-heading"><h2>最近打开</h2><span>{settings.recentProjects.length} 个项目</span></div>{settings.recentProjects.length ? settings.recentProjects.map(recent => <div key={recent.path} className="recent-row"><button className="recent-open" disabled={busy} onClick={() => onRecent(recent.path)} aria-label={`打开最近项目：${recent.name}`}><span className="recent-icon"><FolderOpen size={19} /></span><span><strong>{recent.name}</strong><small title={recent.path}>{recent.path}</small></span><span className="recent-date">{dateLabel(recent.lastOpened)}</span><ChevronRight size={17} /></button><Button variant="ghost" size="icon" title="从最近项目移除" aria-label={`移除最近项目：${recent.name}`} disabled={busy} onClick={() => onForget(recent.path)}><Trash2 size={15} /></Button></div>) : <div className="recent-empty"><Clock3 size={17} /><span>打开过的博客会显示在这里，方便下次继续。</span></div>}</section>
  </div></main>
}

function ArticleInspector({ article, document, loading, error, tab, onTab, onReveal }: { article: Article | null; document: ArticleDocument | null; loading: boolean; error: string | null; tab: 'properties' | 'source'; onTab: (tab: 'properties' | 'source') => void; onReveal: () => void }) {
  const displayed = document?.article ?? article
  return <aside className="inspector" aria-label="文章详情"><div className="inspector-heading"><h2>文章详情</h2><Badge>只读</Badge></div>{!displayed ? <div className="inspector-placeholder"><div className="document-outline"><FileText size={34} strokeWidth={1.25} /></div><h3>选择一篇内容</h3><p>查看文章属性与原始源码，<br />了解文件中的每一个细节。</p></div> : <>
    <div className="inspector-title"><Badge tone={displayed.kind === 'ai-daily' ? 'accent' : 'neutral'}>{displayed.kind === 'ai-daily' ? 'AI 日报' : '普通文章'}</Badge><h3>{displayed.title}</h3><button className="file-location" onClick={onReveal} aria-label="在资源管理器中定位文章" title="在资源管理器中定位文章"><FolderOpen size={13} /><span>{displayed.relativePath}</span><ArrowUpRight size={13} /></button></div>
    <div className="detail-tabs" role="tablist" aria-label="文章详情视图"><button id="properties-tab" role="tab" aria-selected={tab === 'properties'} aria-controls="article-detail-panel" className={cn(tab === 'properties' && 'is-active')} onClick={() => onTab('properties')}><Settings2 size={14} />属性</button><button id="source-tab" role="tab" aria-selected={tab === 'source'} aria-controls="article-detail-panel" className={cn(tab === 'source' && 'is-active')} onClick={() => onTab('source')}><Code2 size={15} />源码</button></div>
    <div className={cn('inspector-body', tab === 'source' && 'source-body')} id="article-detail-panel" role="tabpanel" aria-labelledby={tab === 'properties' ? 'properties-tab' : 'source-tab'}>{loading ? <div className="detail-feedback"><LoaderCircle size={19} className="spin" /><span>正在读取文件…</span></div> : error ? <div className="detail-feedback is-error" role="alert"><AlertCircle size={19} /><p>{error}</p></div> : tab === 'source' ? document ? <><div className="source-caption"><span>{displayed.extension.slice(1).toUpperCase()} 源文件</span><span>{document.source.split('\n').length} 行</span></div><pre className="source-code" aria-label="文章只读源码" tabIndex={0}><code>{document.source}</code></pre></> : null : <>
      <dl className="property-list"><Property label="日期">{dateLabel(displayed.published)}</Property><Property label="分类">{displayed.category ?? '未设置'}</Property><Property label="草稿">{displayed.kind === 'ai-daily' ? '不适用' : displayed.draft === null ? '字段无效' : displayed.draft ? '是' : '否'}</Property><Property label="Git 状态"><Badge tone={displayed.fileStatus === 'conflict' ? 'warning' : 'neutral'}>{statusLabels[displayed.fileStatus]}</Badge></Property>{displayed.kind === 'post' && <Property label="置顶序号">{displayed.top ?? '未设置'}</Property>}<Property label="文件大小">{byteLabel(displayed.size)}</Property><Property label="本地修改">{dateLabel(displayed.modifiedAt, true)}</Property></dl>
      <div className="property-section"><h4>标签</h4><div className="tag-list">{displayed.tags.length ? displayed.tags.map((value, idx) => <Badge key={`${value}-${idx}`}>{value}</Badge>) : <span className="muted">暂无标签</span>}</div></div>
      <div className="property-section"><h4>{displayed.kind === 'ai-daily' ? '日报摘要' : '文章描述'}</h4><p>{(displayed.kind === 'ai-daily' ? displayed.summary : displayed.description) || '暂无内容'}</p></div>
      {displayed.kind === 'ai-daily' && <><div className="property-section"><h4>要点 <span>{displayed.highlights.length}</span></h4>{displayed.highlights.length ? <ul className="highlights">{displayed.highlights.map((value, idx) => <li key={idx}>{value}</li>)}</ul> : <p>暂无要点</p>}</div><div className="property-section"><h4>工具</h4><div className="tag-list">{displayed.tools.length ? displayed.tools.map((value, idx) => <Badge key={`${value}-${idx}`}>{value}</Badge>) : <span className="muted">暂无工具</span>}</div></div></>}
      {!!displayed.issues.length && <div className="property-section article-issues"><h4><AlertCircle size={14} />字段提示</h4><ul>{displayed.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}</ul></div>}
      {document && <details className="frontmatter-details"><summary>完整 Frontmatter</summary><pre>{JSON.stringify(document.frontmatter, null, 2)}</pre></details>}
      <p className="local-state-note"><CircleHelp size={13} /><span>日期与 Git 状态来自本地文件，无法据此判断线上部署状态。</span></p>
    </>}</div>
  </>}</aside>
}

function Property({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div> }

function SettingsView({ project, settings, themeBusy, onTheme, onOpenFolder, issues, onOpenProject, busy }: { project: ProjectInfo | null; settings: AppSettings; themeBusy: boolean; onTheme: (theme: Theme) => Promise<void>; onOpenFolder: () => void; issues: ContentIndex['issues']; onOpenProject: () => void; busy: boolean }) {
  return <main className="settings-content"><div className="settings-inner"><div className="heading-overline">工作空间</div><h1>项目设置</h1><p className="settings-intro">当前项目的信息与桌面偏好。</p>
    <section className="settings-section"><div className="settings-section-title"><div><h2>外观</h2><p>为你的工作环境选择合适的界面。</p></div></div><div className="theme-options">{([{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button key={value} className={cn('theme-option', settings.theme === value && 'is-active')} aria-pressed={settings.theme === value} disabled={themeBusy} onClick={() => void onTheme(value)}><Icon size={19} /><span>{label}</span>{settings.theme === value && <Check size={15} />}</button>)}</div></section>
    <section className="settings-section"><div className="settings-section-title"><div><h2>博客项目</h2><p>读取现有博客文件与配置，不执行项目脚本。</p></div>{project && <Button size="small" onClick={onOpenFolder}><FolderOpen size={15} />打开文件夹</Button>}</div>{project ? <dl className="settings-facts"><Property label="项目名称">{project.name}</Property><Property label="本地目录"><code>{project.path}</code></Property><Property label="适配器">promefire / Astro_Blog</Property><Property label="Astro 版本">{project.astroVersion}</Property><Property label="包管理器">{project.packageManager ?? '未声明'}</Property><Property label="普通文章"><code>{project.contentDirectories.post}</code></Property><Property label="AI 日报"><code>{project.contentDirectories['ai-daily']}</code></Property></dl> : <div className="settings-no-project"><FolderOpen size={25} /><p>选择博客目录后查看项目配置。</p><Button onClick={onOpenProject} disabled={busy}>打开项目</Button></div>}</section>
    {project && <><section className="settings-section"><div className="settings-section-title"><div><h2>Git 信息</h2><p>来自本地仓库的只读信息。</p></div></div><dl className="settings-facts"><Property label="Git 可用">{project.git.available ? '可用' : '不可用'}</Property><Property label="仓库状态">{project.git.isRepository ? '已识别 Git 仓库' : '非 Git 仓库'}</Property><Property label="当前分支">{project.git.branch ?? '未识别'}</Property><Property label="远程地址"><code>{project.git.remote ?? '未配置'}</code></Property></dl>{project.git.error && <p className="settings-warning"><AlertCircle size={15} />{project.git.error}</p>}</section><section className="settings-section"><div className="settings-section-title"><div><h2>项目脚本</h2><p>读取自 package.json，后续用于预览与构建服务。</p></div><Badge>只读</Badge></div>{Object.keys(project.scripts).length ? <dl className="script-list">{Object.entries(project.scripts).map(([name, command]) => <div key={name}><dt>{name}</dt><dd><code>{command}</code></dd></div>)}</dl> : <p className="muted">未声明脚本</p>}</section>{(project.warnings.length > 0 || issues.length > 0) && <section className="settings-section"><div className="settings-section-title"><div><h2>读取提示</h2><p>修正文件后刷新内容库以重新检查。</p></div><Badge tone="warning">{project.warnings.length + issues.length} 项</Badge></div><ul className="settings-issues">{project.warnings.map((warning, idx) => <li key={`project-${idx}`}><AlertCircle size={16} /><p>{warning}</p></li>)}{issues.map((issue, idx) => <li key={`file-${idx}`}><AlertCircle size={16} /><div><code>{issue.path}</code><p>{issue.message}</p></div></li>)}</ul></section>}</>}
  </div></main>
}

export default App
