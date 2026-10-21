import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useBlocker, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle, ArrowDownUp, ArrowUpRight, BookOpen, ChartColumn, Check, ChevronLeft, ChevronRight,
  Clock3, CloudUpload, File, FileText, Folder, FolderOpen, GitBranch, Globe, Layers3,
  LoaderCircle, Monitor, Moon, RefreshCw, Search,
  Settings2, Sparkles, Sun, Tag, Trash2, X, Plus,
} from 'lucide-react'
import type { AppSettings, Article, ArticleDocument, ContentIndex, CreateDraftInput, DesktopApi, FileStatus, PreviewPhase, ProjectInfo, RecoveryIndex, Result, Theme } from '../../shared/contracts'
import { categoryFromSelect, categorySelectValue, matchesArticle, summarize, tagFromSelect, tagSelectValue, type CategoryFilter, type LibraryQuery, type LibraryView, type TagFilter } from '../../shared/article-stats'
import { Badge, Button, Input, cn } from './components/ui'
import { CreateDraftDialog } from './components/CreateDraftDialog'
import { ArticleEditor, type ArticleEditorHandle } from './components/ArticleEditor'
import { RecoveriesDialog } from './components/RecoveriesDialog'
import { ExternalEditorSettings } from './components/ExternalEditorSettings'
import { ImageStorageSettings } from './components/ImageStorageSettings'
import { PreviewPanel } from './components/PreviewPanel'
import { StatsView } from './components/StatsView'
import { SyncDialog } from './components/SyncDialog'
import { ArticleListRow } from './components/ArticleListRow'
import { Modal } from './components/Modal'

const EMPTY_SETTINGS: AppSettings = { version: 1, theme: 'system', recentProjects: [], lastProjectPath: null, previewRuntime: { nodePath: null, npmPath: null }, markdownHtml: false }
const EMPTY_INDEX: ContentIndex = { articles: [], issues: [], scannedAt: '' }
const PAGE_SIZE = 12
type SortOrder = 'published-desc' | 'published-asc' | 'modified-desc' | 'title'
const viewLabels: Record<LibraryView, string> = { all: '全部内容', posts: '正文', drafts: '草稿', daily: 'AI 日报', writing: '正文和草稿' }
function kindLabel(article: Article): string {
  if (article.kind === 'ai-daily') return 'AI 日报'
  if (article.kind === 'draft') return '草稿'
  return '正文'
}
const statusLabels: Record<FileStatus, string> = { clean: '无改动', modified: '已修改', added: '已暂存新增', deleted: '已删除', untracked: '未跟踪', conflict: '存在冲突', ignored: '已忽略', unknown: '状态未知' }

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
  const [markdownBusy, setMarkdownBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdNotice, setCreatedNotice] = useState<string | null>(null)
  const pendingCreatedPath = useRef<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [document, setDocument] = useState<ArticleDocument | null>(null)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const editor = useRef<ArticleEditorHandle>(null)
  const editorDirty = useRef(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const leaveAction = useRef<(() => void) | null>(null)
  const [recoveries, setRecoveries] = useState<RecoveryIndex>({ entries: [], issues: [] })
  const [recoveriesOpen, setRecoveriesOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('idle')
  const [recoveryRefresh, setRecoveryRefresh] = useState(0)
  const blocker = useBlocker(() => editorDirty.current)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>({ type: 'all' })
  const [tagFilter, setTagFilter] = useState<TagFilter>({ type: 'all' })
  const pendingQuery = useRef<LibraryQuery | null>(null)
  const [sort, setSort] = useState<SortOrder>('published-desc')
  const [page, setPage] = useState(1)
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Article | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const operationId = useRef(0)
  const readId = useRef(0)
  const busyRef = useRef(false)
  const selectedRef = useRef<string | null>(null)

  const rawView = location.pathname.split('/')[2]
  const view: LibraryView = rawView && Object.hasOwn(viewLabels, rawView) ? rawView as LibraryView : 'all'
  const isSettings = location.pathname === '/settings'
  const isProjects = location.pathname === '/projects'
  const isStats = location.pathname === '/stats'
  const reportDirty = useCallback((dirty: boolean) => { editorDirty.current = dirty; api?.setEditorDirty(dirty) }, [api])
  const requestLeave = (action: () => void) => {
    if (editor.current?.isBusy()) { setError('文章正在处理操作，请稍后重试。'); return }
    if (!editorDirty.current) { action(); return }
    leaveAction.current = action; setLeaveOpen(true)
  }
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (editor.current?.isBusy()) { blocker.reset(); return }
      leaveAction.current = () => blocker.proceed(); setLeaveOpen(true)
    }
  }, [blocker])
  useEffect(() => {
    if (!api) return
    const stop = api.onCloseRequested(() => requestLeave(() => void unwrap(api.closeWindow()).catch(cause => setError(errorMessage(cause)))))
    const protectReload = (event: BeforeUnloadEvent) => { if (editorDirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protectReload)
    return () => { stop(); window.removeEventListener('beforeunload', protectReload) }
  }, [api])
  useEffect(() => {
    if (!api) return
    const stop = api.onPreviewState(snapshot => setPreviewPhase(snapshot.phase))
    void unwrap(api.getPreview()).then(snapshot => setPreviewPhase(snapshot.phase)).catch(() => undefined)
    return stop
  }, [api])
  useEffect(() => {
    if (!api) return
    return api.onContentChanged(() => {
      const token = operationId.current
      void unwrap(api.listArticles()).then(next => { if (token === operationId.current) setIndex(next) }).catch(() => undefined)
    })
  }, [api])
  const loadRecoveries = useCallback(async () => {
    if (!api || !project) return
    const token = operationId.current
    try { const records = await unwrap(api.listEditorRecoveries()); if (token === operationId.current) setRecoveries(records) }
    catch (cause) { if (token === operationId.current) setError(errorMessage(cause)) }
  }, [api, project?.path])
  useEffect(() => { setRecoveries({ entries: [], issues: [] }); void loadRecoveries() }, [loadRecoveries])
  const finishLeave = async (save: boolean) => {
    setLeaving(true)
    const done = save ? await editor.current?.save() : await editor.current?.discard()
    setLeaving(false)
    if (!done) { setLeaveOpen(false); if (blocker.state === 'blocked') blocker.reset(); return }
    const action = leaveAction.current
    leaveAction.current = null; setLeaveOpen(false)
    action?.()
  }
  const cancelLeave = () => { if (leaving) return; setLeaveOpen(false); leaveAction.current = null; if (blocker.state === 'blocked') blocker.reset() }

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { window.document.documentElement.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  // 创建提示是浮层，3 秒后自动消失；新提示会重新计时。
  useEffect(() => {
    if (!createdNotice) return
    const timer = setTimeout(() => setCreatedNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [createdNotice])

  const selectArticle = useCallback((path: string | null) => {
    if (selectedRef.current === path) return
    readId.current += 1
    selectedRef.current = path
    setSelectedPath(path)
    setDocument(null)
    setDocumentError(null)
    setDocumentLoading(!!path)
    reportDirty(false)
  }, [reportDirty])

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
  }, [api, selectedPath, busy, recoveryRefresh])

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
      setSearch(''); setCategoryFilter({ type: 'all' }); setTagFilter({ type: 'all' }); setPage(1)
      navigate('/library/all')
      const nextIndex = await unwrap(api.listArticles())
      if (token !== operationId.current) return
      applyIndex(nextIndex, false)
      setSettings(await unwrap(api.getSettings()))
      void loadRecoveries()
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
      void loadRecoveries()
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
      setSearch(''); setCategoryFilter({ type: 'all' }); setTagFilter({ type: 'all' }); setPage(1); setSort('modified-desc')
      setIndex(current => ({ ...current, articles: [created.article, ...current.articles], scannedAt: new Date().toISOString() }))
      if (view === 'drafts') selectArticle(created.article.relativePath)
      else pendingCreatedPath.current = created.article.relativePath
      navigate('/library/drafts')
      setInspectorOpen(true)
      setCreatedNotice(`草稿已创建：${created.article.relativePath}`)
      setError(null)
      setCreateOpen(false)
    } finally { setBusy(false); busyRef.current = false }
  }

  const confirmDelete = async () => {
    if (!api || !project || !pendingDelete || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const removed = pendingDelete.relativePath
      await unwrap(api.deleteArticle({ projectPath: project.path, relativePath: removed }))
      setPendingDelete(null)
      setIndex(current => ({ ...current, articles: current.articles.filter(article => article.relativePath !== removed), scannedAt: new Date().toISOString() }))
      if (selectedRef.current === removed) selectArticle(null)
      void loadRecoveries()
    } catch (cause) { setDeleteError(errorMessage(cause)) }
    finally { setDeleting(false) }
  }

  // 发布到正文和撤回为草稿都只把文章移动到另一个内容目录，编辑器继续跟随新路径。
  const followRelocatedArticle = (moved: ArticleDocument) => {
    if (!api) return
    setSelectedPath(moved.article.relativePath)
    void unwrap(api.listArticles()).then(next => setIndex(next)).catch(cause => setError(errorMessage(cause)))
    void loadRecoveries()
  }

  const changeTheme = async (theme: Theme) => {
    if (!api || themeBusy) return
    setThemeBusy(true)
    try { setSettings(await unwrap(api.setTheme(theme))) } catch (cause) { setError(errorMessage(cause)) }
    finally { setThemeBusy(false) }
  }

  const changeMarkdownHtml = async (enabled: boolean) => {
    if (!api || markdownBusy) return
    setMarkdownBusy(true)
    try { setSettings(await unwrap(api.setMarkdownHtml(enabled))) } catch (cause) { setError(errorMessage(cause)) }
    finally { setMarkdownBusy(false) }
  }

  const forgetProject = async (path: string) => {
    if (!api || busyRef.current) return
    try { setSettings(await unwrap(api.forgetProject(path))) } catch (cause) { setError(errorMessage(cause)) }
  }

  const scopeArticles = useMemo(() => index.articles.filter(article => matchesArticle(article, { view, category: { type: 'all' }, tag: { type: 'all' } })), [index.articles, view])
  const categories = useMemo(() => Array.from(new Set(scopeArticles.map(article => article.category).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [scopeArticles])
  const tags = useMemo(() => Array.from(new Set(scopeArticles.flatMap(article => article.tags))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [scopeArticles])
  const filtered = useMemo(() => {
    const query = search.toLocaleLowerCase().trim()
    return scopeArticles.filter(article => matchesArticle(article, { view, category: categoryFilter, tag: tagFilter }) && (!query || `${article.title}\n${article.relativePath}`.toLocaleLowerCase().includes(query))).sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN')
      if (sort === 'modified-desc') return b.modifiedAt.localeCompare(a.modifiedAt)
      const comparison = (a.published ?? '').localeCompare(b.published ?? '')
      return sort === 'published-asc' ? comparison : -comparison
    })
  }, [scopeArticles, view, search, categoryFilter, tagFilter, sort])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageArticles = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const selectedArticle = index.articles.find(article => article.relativePath === selectedPath) ?? null
  const counts = useMemo(() => ({ all: index.articles.length, posts: index.articles.filter(article => article.kind === 'post').length, drafts: index.articles.filter(article => article.kind === 'draft').length, daily: index.articles.filter(article => article.kind === 'ai-daily').length }), [index.articles])
  const stats = useMemo(() => summarize(index.articles, index.issues.length), [index.articles, index.issues.length])
  const openLibrary = (query: LibraryQuery) => {
    requestLeave(() => {
      selectArticle(null)
      setSearch('')
      if (view === query.view && location.pathname.startsWith('/library/')) { setCategoryFilter(query.category); setTagFilter(query.tag); setPage(1); return }
      pendingQuery.current = query
      navigate(`/library/${query.view}`)
    })
  }

  useEffect(() => { setPage(1) }, [view, search, categoryFilter, tagFilter, sort])
  useEffect(() => { setMenuPath(null) }, [location.pathname, page, search])
  useEffect(() => {
    const pending = pendingQuery.current
    pendingQuery.current = null
    if (pending?.view === view) { setCategoryFilter(pending.category); setTagFilter(pending.tag) }
    else { setCategoryFilter({ type: 'all' }); setTagFilter({ type: 'all' }) }
    selectArticle(view === 'drafts' ? pendingCreatedPath.current : null)
    pendingCreatedPath.current = null
  }, [view, selectArticle])

  const busyAll = busy || initializing
  const showWelcome = !project || isProjects
  // 侧边栏按内容目录渲染：post 是正文、drafts 是草稿、ai-daily 是 AI 日报，
  // 目录不存在就不显示对应入口。没有打开项目时保留全部入口，还没有目录可以判断。
  const navItems = [
    { view: 'all' as const, icon: Layers3, kind: null },
    { view: 'posts' as const, icon: FileText, kind: 'post' as const },
    { view: 'drafts' as const, icon: File, kind: 'draft' as const },
    { view: 'daily' as const, icon: Sparkles, kind: 'ai-daily' as const },
  ].filter(item => !item.kind || !project || project.contentPresence[item.kind])

  return <div className="app-shell">
    <aside className={cn('sidebar', !sidebarOpen && 'is-collapsed')} id="app-sidebar" aria-label="主导航">
      <div className="brand"><div className="brand-symbol"><Sparkles size={22} strokeWidth={1.8} /></div><div className="brand-text"><strong>Astro<span> Desktop</span></strong><small>本地博客工作台</small></div></div>
      <NavLink to="/projects" className={cn('project-switcher', isProjects && 'is-active')} aria-label={project?.name ?? '选择博客项目'} title={project?.name ?? '选择博客项目'}>
        <span className="project-avatar"><Folder size={18} /></span>
        <span className="project-switcher-text"><strong>{project?.name ?? '选择博客项目'}</strong><small>{project ? '本地项目' : '连接你的内容'}</small></span>
        <ChevronRight size={15} />
      </NavLink>
      <div className="nav-group-label">内容库</div>
      <nav className="main-nav">
        {navItems.map(({ view: item, icon: Icon }) => <NavLink key={item} to={`/library/${item}`} className={cn('nav-item', !isSettings && !isProjects && !isStats && view === item && 'is-active')} aria-label={viewLabels[item]} title={viewLabels[item]}><Icon size={17} /><span>{viewLabels[item]}</span><span className="nav-count">{project ? counts[item] : '·'}</span></NavLink>)}
        <NavLink to="/stats" className={cn('nav-item', isStats && 'is-active')} aria-label="文章统计" title="文章统计"><ChartColumn size={17} /><span>文章统计</span></NavLink>
      </nav>
      <div className="sidebar-bottom">
        <NavLink to="/settings" className={({ isActive }) => cn('nav-item', isActive && 'is-active')} aria-label="项目设置" title="项目设置"><Settings2 size={17} /><span>项目设置</span></NavLink>
        <button type="button" className="nav-item theme-nav-item" aria-label={settings.theme === 'dark' ? '切换浅色模式' : '切换深色模式'} title={settings.theme === 'dark' ? '切换浅色模式' : '切换深色模式'} disabled={!api || themeBusy} onClick={() => void changeTheme(settings.theme === 'dark' ? 'light' : 'dark')}>{settings.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}<span>{settings.theme === 'dark' ? '切换浅色模式' : '切换深色模式'}</span></button>
      </div>
      <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-expanded={sidebarOpen} aria-controls="app-sidebar" aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'} title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}>{sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}</button>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <div className="project-context"><FolderOpen size={16} /><span title={project?.path}>{project?.name ?? '工作空间'}</span>{project && <><span className="context-divider">/</span><span className="branch" title={project.git.error ?? '本地 Git 分支'}><GitBranch size={14} />{project.git.branch ?? (project.git.isRepository ? '游离 HEAD' : '非 Git 仓库')}</span></>}</div>
        <div className="topbar-actions">{project && <>{(recoveries.entries.length > 0 || recoveries.issues.length > 0) && <Button size="small" onClick={() => setRecoveriesOpen(true)}>恢复记录 ({recoveries.entries.length})</Button>}<Button size="small" variant={previewPhase === 'running' ? 'primary' : 'secondary'} onClick={() => setPreviewOpen(true)}><Globe size={15} />{previewPhase === 'running' ? '预览运行中' : '本地预览'}</Button><Button size="small" disabled={busyAll || !project.git.isRepository} title={project.git.isRepository ? '先拉取远程，确认文件列表后提交并推送' : project.git.error ?? '当前项目不是 Git 仓库'} onClick={() => requestLeave(() => setSyncOpen(true))}><CloudUpload size={15} /><span>推送</span></Button><Button size="small" variant="ghost" disabled={busyAll} onClick={() => requestLeave(() => void refresh())} aria-label="刷新文章"><RefreshCw size={15} className={busy ? 'spin' : ''} /><span>刷新</span></Button></>}<Button size="small" disabled={!api || busyAll} onClick={() => requestLeave(() => void openProject())}><FolderOpen size={15} />打开项目</Button></div>
      </header>

      {error && <div className="error-banner" role="alert"><AlertCircle size={17} /><span>{error}</span><Button size="icon" variant="ghost" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={15} /></Button></div>}
      {createdNotice && <div className="created-toast" role="status"><Check size={17} /><span>{createdNotice}</span><Button size="icon" variant="ghost" aria-label="关闭创建提示" onClick={() => setCreatedNotice(null)}><X size={15} /></Button></div>}

      {!api ? <main className="welcome-content"><EmptyState icon={<Monitor size={32} />} title="请在 Astro Desktop 中打开" description="本地文件系统与目录选择需要 Electron 桌面环境。请在项目目录运行 npm run dev 启动桌面应用。" /></main>
        : initializing ? <main className="welcome-content"><EmptyState icon={<LoaderCircle size={28} className="spin" />} title="正在打开工作空间" description="读取本地设置与文章索引…" /></main>
          : isSettings ? <SettingsView api={api} project={project} settings={settings} themeBusy={themeBusy} markdownBusy={markdownBusy} onTheme={changeTheme} onMarkdownHtml={changeMarkdownHtml} onOpenFolder={() => void runAction(desktop => desktop.openProjectFolder())} issues={index.issues} onOpenProject={() => void openProject()} busy={busy} />
            : showWelcome ? <WelcomeView settings={settings} project={project} busy={busy} onOpen={() => void openProject()} onRecent={path => void openProject(path)} onForget={path => void forgetProject(path)} onContinue={() => navigate('/library/all')} />
              : isStats ? <StatsView projectName={project.name} projectPath={project.path} scannedAt={index.scannedAt} stats={stats} issues={index.issues} busy={busy} onOpen={openLibrary} />
              : <main className="library-layout">
                <section className="library" aria-label="文章库" hidden={!!selectedPath}>
                  <div className="library-heading"><div><h1>{viewLabels[view]} <span>{filtered.length}</span></h1></div></div>
                  <div className="library-toolbar">
                    {view !== 'daily' && <Button variant="primary" disabled={busyAll} onClick={() => setCreateOpen(true)}><Plus size={16} />新建文章</Button>}
                    <div className="search-input"><Search size={16} /><Input type="search" placeholder="搜索标题或文件名…" aria-label="搜索文章" value={search} onChange={event => setSearch(event.target.value)} /></div>
                    <label className="sort-select"><ArrowDownUp size={14} /><select aria-label="文章排序" value={sort} onChange={event => setSort(event.target.value as SortOrder)}><option value="published-desc">日期从新到旧</option><option value="published-asc">日期从旧到新</option><option value="modified-desc">最近修改</option><option value="title">标题排序</option></select></label>
                  </div>
                  <div className="filter-toolbar"><label className="filter-select"><Folder size={14} /><select aria-label="按分类筛选" value={categorySelectValue(categoryFilter)} onChange={event => setCategoryFilter(categoryFromSelect(event.target.value))}><option value="">全部分类</option><option value="missing">未填写分类</option>{categories.map(value => <option key={value} value={categorySelectValue({ type: 'name', name: value })}>{value}</option>)}</select></label><label className="filter-select"><Tag size={14} /><select aria-label="按标签筛选" value={tagSelectValue(tagFilter)} onChange={event => setTagFilter(tagFromSelect(event.target.value))}><option value="">全部标签</option>{tagFilter.type === 'untagged' && <option value="untagged">无标签（不是标签名）</option>}{tags.map(value => <option key={value} value={tagSelectValue({ type: 'name', name: value })}>{value}</option>)}</select></label>{(search || categoryFilter.type !== 'all' || tagFilter.type !== 'all') && <Button size="small" variant="ghost" onClick={() => { setSearch(''); setCategoryFilter({ type: 'all' }); setTagFilter({ type: 'all' }) }}>清除筛选</Button>}<span className="filter-total">{filtered.length} 篇内容</span></div>
                  {index.issues.length > 0 && <button className="scan-warning" onClick={() => navigate('/settings')}><AlertCircle size={15} /><span>读取时发现 {index.issues.length} 项问题，查看详情</span><ChevronRight size={14} /></button>}
                  <div className="article-table" aria-busy={busy}>
                    <div className="table-head"><span>文章</span><span>日期</span><span className="category-cell">分类</span><span>本地状态</span><span className="article-actions-head" /></div>
                    <div className="table-body">
                      {busy ? <EmptyState compact icon={<LoaderCircle size={25} className="spin" />} title="正在读取文章" description="扫描本地文件与 Git 状态…" /> : pageArticles.length === 0 ? <EmptyState compact icon={<Search size={26} />} title={search || categoryFilter.type !== 'all' || tagFilter.type !== 'all' ? '没有匹配的内容' : '这里还没有内容'} description={search || categoryFilter.type !== 'all' || tagFilter.type !== 'all' ? '试试其他关键词，或清除当前筛选条件。' : '此内容目录没有可读取的文章，添加文件后点击刷新。'} /> : pageArticles.map(article => <ArticleListRow key={article.id} article={article} selected={selectedPath === article.relativePath} menuOpen={menuPath === article.relativePath} kindLabel={kindLabel(article)} statusLabel={statusLabels[article.fileStatus]} dateLabel={dateLabel(article.published)} onOpen={() => { setMenuPath(null); selectArticle(article.relativePath); setInspectorOpen(true) }} onToggleMenu={() => setMenuPath(current => current === article.relativePath ? null : article.relativePath)} onDelete={() => { setMenuPath(null); setDeleteError(null); setPendingDelete(article) }} />)}
                    </div>
                  </div>
                  <div className="pagination"><span>{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)}` : '0'} / {filtered.length} 篇</span><div><Button size="icon" variant="ghost" aria-label="上一页" disabled={currentPage <= 1 || busy} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><span>{currentPage} / {totalPages}</span><Button size="icon" variant="ghost" aria-label="下一页" disabled={currentPage >= totalPages || busy} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
                </section>
                {selectedPath && (!document || busy || documentLoading ? <section className="editor-loading"><Button onClick={() => selectArticle(null)}><ChevronLeft size={16} />返回列表</Button><EmptyState icon={<FileText size={25} />} title={documentError ? '无法打开文章' : '正在读取文章'} description={documentError ?? '加载原始源码与恢复记录…'} /></section> : <ArticleEditor key={`${project.path}:${selectedPath}`} ref={editor} api={api} projectPath={project.path} document={document} htmlEnabled={settings.markdownHtml} onDirtyChange={reportDirty} onRecoveryChange={() => void loadRecoveries()} onSaved={saved => { setDocument(saved); setIndex(current => ({ ...current, articles: current.articles.map(article => article.relativePath === saved.article.relativePath ? saved.article : article) })) }} onPublished={followRelocatedArticle} onWithdrawn={followRelocatedArticle} onBack={() => requestLeave(() => selectArticle(null))} />)}
                {selectedPath && <div className={cn('inspector-shell', !inspectorOpen && 'is-collapsed')}><button type="button" className="inspector-toggle" onClick={() => setInspectorOpen(!inspectorOpen)} aria-expanded={inspectorOpen} aria-controls="article-inspector" aria-label={inspectorOpen ? '收起文章属性' : '展开文章属性'} title={inspectorOpen ? '收起文章属性' : '展开文章属性'}>{inspectorOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>{inspectorOpen && <ArticleInspector article={selectedArticle} document={document} loading={documentLoading || busy} error={documentError} onReveal={() => selectedPath && void runAction(desktop => desktop.revealArticle(selectedPath))} />}</div>}
              </main>}

      <footer className="statusbar"><div><span className={cn('status-dot', project && 'is-connected')} /><span>{busyAll ? '正在处理本地项目…' : project ? '已连接本地项目' : '尚未连接项目'}</span>{project && <span className="status-path" title={project.path}>{project.path}</span>}</div><div>{index.scannedAt && <span>更新于 {new Date(index.scannedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}</div></footer>
    </div>
    {createOpen && project && <CreateDraftDialog categories={[...new Set(index.articles.filter(article => article.kind !== 'ai-daily').map(article => article.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'zh-CN'))} availableTags={[...new Set(index.articles.filter(article => article.kind !== 'ai-daily').flatMap(article => article.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))} onCreate={createDraft} onClose={() => setCreateOpen(false)} />}
    {pendingDelete && <Modal title="确认删除文章" onCancel={() => { if (!deleting) setPendingDelete(null) }}><p>将从磁盘删除「{pendingDelete.title}」。</p><p><code>{pendingDelete.relativePath}</code></p><p>文件会被直接移除。应用不会保留副本，也不能在这里撤销。未保存的恢复记录会一并清除。</p>{deleteError && <p role="alert">{deleteError}</p>}<div className="dialog-actions"><Button disabled={deleting} onClick={() => setPendingDelete(null)}>取消</Button><Button className="button-danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? '正在删除…' : '确认删除'}</Button></div></Modal>}
    {leaveOpen && <Modal title="文章有未保存的修改" onCancel={cancelLeave}><p>保存后继续，或明确放弃本次修改。保存失败时会留在编辑器。</p><div className="dialog-actions"><Button disabled={leaving} onClick={cancelLeave}>取消</Button><Button disabled={leaving} onClick={() => void finishLeave(false)}>放弃修改</Button><Button disabled={leaving} variant="primary" onClick={() => void finishLeave(true)}>保存并继续</Button></div></Modal>}
    {recoveriesOpen && api && <RecoveriesDialog api={api} index={recoveries} onClose={() => setRecoveriesOpen(false)} onChanged={() => void loadRecoveries()} onOpen={path => requestLeave(() => { selectArticle(path); setRecoveryRefresh(value => value + 1); if (!location.pathname.startsWith('/library/')) navigate('/library/all') })} />}
    {previewOpen && api && <PreviewPanel api={api} onClose={() => setPreviewOpen(false)} />}
    {syncOpen && api && project && <SyncDialog api={api} projectPath={project.path} onClose={() => setSyncOpen(false)} onPushed={() => void refresh()} />}
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

function ArticleInspector({ article, document, loading, error, onReveal }: { article: Article | null; document: ArticleDocument | null; loading: boolean; error: string | null; onReveal: () => void }) {
  const displayed = document?.article ?? article
  return <aside className="inspector" id="article-inspector" aria-label="文章详情"><div className="inspector-heading"><h2>文章属性</h2><Badge>已保存版本</Badge></div>{!displayed ? <div className="inspector-placeholder"><div className="document-outline"><FileText size={34} strokeWidth={1.25} /></div><h3>正在读取文章属性</h3><p>属性来自磁盘上的已保存版本，<br />不包含编辑区里尚未保存的内容。</p></div> : <>
    <div className="inspector-title"><Badge tone={displayed.kind === 'ai-daily' ? 'accent' : 'neutral'}>{kindLabel(displayed)}</Badge><h3>{displayed.title}</h3><button className="file-location" onClick={onReveal} aria-label="在资源管理器中定位文章" title="在资源管理器中定位文章"><FolderOpen size={13} /><span>{displayed.relativePath}</span><ArrowUpRight size={13} /></button></div>
    <div className="inspector-body" role="region" aria-label="文章属性">{loading ? <div className="detail-feedback"><LoaderCircle size={19} className="spin" /><span>正在读取文件…</span></div> : error ? <div className="detail-feedback is-error" role="alert"><AlertCircle size={19} /><p>{error}</p></div> : <>
      <dl className="property-list"><Property label="日期">{dateLabel(displayed.published)}</Property><Property label="分类">{displayed.category ?? '未设置'}</Property><Property label="draft 字段">{displayed.kind === 'ai-daily' ? '不适用' : displayed.issues.some(issue => issue.startsWith('draft 必须是布尔值')) ? '字段无效' : displayed.draft === null ? '未设置' : displayed.draft ? 'true' : 'false'}</Property><Property label="Git 状态"><Badge tone={displayed.fileStatus === 'conflict' ? 'warning' : 'neutral'}>{statusLabels[displayed.fileStatus]}</Badge></Property>{displayed.kind !== 'ai-daily' && <Property label="置顶序号">{displayed.top ?? '未设置'}</Property>}<Property label="文件大小">{byteLabel(displayed.size)}</Property><Property label="本地修改">{dateLabel(displayed.modifiedAt, true)}</Property></dl>
      <div className="property-section"><h4>标签</h4><div className="tag-list">{displayed.tags.length ? displayed.tags.map((value, idx) => <Badge key={`${value}-${idx}`}>{value}</Badge>) : <span className="muted">暂无标签</span>}</div></div>
      <div className="property-section"><h4>{displayed.kind === 'ai-daily' ? '日报摘要' : '文章描述'}</h4><p>{(displayed.kind === 'ai-daily' ? displayed.summary : displayed.description) || '暂无内容'}</p></div>
      {displayed.kind === 'ai-daily' && <><div className="property-section"><h4>要点 <span>{displayed.highlights.length}</span></h4>{displayed.highlights.length ? <ul className="highlights">{displayed.highlights.map((value, idx) => <li key={idx}>{value}</li>)}</ul> : <p>暂无要点</p>}</div><div className="property-section"><h4>工具</h4><div className="tag-list">{displayed.tools.length ? displayed.tools.map((value, idx) => <Badge key={`${value}-${idx}`}>{value}</Badge>) : <span className="muted">暂无工具</span>}</div></div></>}
      {!!displayed.issues.length && <div className="property-section article-issues"><h4><AlertCircle size={14} />字段提示</h4><ul>{displayed.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}</ul></div>}
      {document && <details className="frontmatter-details"><summary>完整 Frontmatter</summary><pre>{JSON.stringify(document.frontmatter, null, 2)}</pre></details>}
    </>}</div>
  </>}</aside>
}

function Property({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div> }

function SettingsView({ api, project, settings, themeBusy, markdownBusy, onTheme, onMarkdownHtml, onOpenFolder, issues, onOpenProject, busy }: { api: DesktopApi | undefined; project: ProjectInfo | null; settings: AppSettings; themeBusy: boolean; markdownBusy: boolean; onTheme: (theme: Theme) => Promise<void>; onMarkdownHtml: (enabled: boolean) => Promise<void>; onOpenFolder: () => void; issues: ContentIndex['issues']; onOpenProject: () => void; busy: boolean }) {
  return <main className="settings-content"><div className="settings-inner"><div className="settings-heading"><div><div className="heading-overline">工作空间</div><h1>项目设置</h1><p className="settings-intro">当前项目的信息与桌面偏好。</p></div><Button size="icon" variant="ghost" aria-label={settings.theme === 'dark' ? '切换浅色主题' : '切换深色主题'} title={settings.theme === 'dark' ? '切换浅色主题' : '切换深色主题'} disabled={!api || themeBusy} onClick={() => void onTheme(settings.theme === 'dark' ? 'light' : 'dark')}>{settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</Button></div>
    <section className="settings-section"><div className="settings-section-title"><div><h2>外观</h2><p>为你的工作环境选择合适的界面。</p></div></div><div className="theme-options">{([{ value: 'light', label: '浅色', icon: Sun }, { value: 'dark', label: '深色', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const).map(({ value, label, icon: Icon }) => <button key={value} className={cn('theme-option', settings.theme === value && 'is-active')} aria-pressed={settings.theme === value} disabled={themeBusy} onClick={() => void onTheme(value)}><Icon size={19} /><span>{label}</span>{settings.theme === value && <Check size={15} />}</button>)}</div></section>
    <section className="settings-section" aria-label="Markdown"><div className="settings-section-title"><div><h2>Markdown</h2><p>只影响编辑模式里的 HTML 显示，不改文章文件。</p></div></div><div className="setting-switch-row"><div><strong>启用 HTML 支持</strong><p>打开后，编辑模式显示消毒后的 HTML 预览，不执行脚本，也不应用 style。关闭后只显示原始标签。源码模式和 MDX 不受影响。</p></div><button type="button" role="switch" className={cn('setting-switch', settings.markdownHtml && 'is-on')} aria-checked={settings.markdownHtml} aria-label="启用 HTML 支持" disabled={!api || markdownBusy} onClick={() => void onMarkdownHtml(!settings.markdownHtml)}><span /></button></div></section>
    {api && <ExternalEditorSettings api={api} />}
    {api && <ImageStorageSettings api={api} />}
    <section className="settings-section"><div className="settings-section-title"><div><h2>博客项目</h2><p>读取现有博客文件与配置，不执行项目脚本。</p></div>{project && <Button size="small" onClick={onOpenFolder}><FolderOpen size={15} />打开文件夹</Button>}</div>{project ? <dl className="settings-facts"><Property label="项目名称">{project.name}</Property><Property label="本地目录"><code>{project.path}</code></Property><Property label="适配器">promefire / Astro_Blog</Property><Property label="Astro 版本">{project.astroVersion}</Property><Property label="包管理器">{project.packageManager ?? '未声明'}</Property><Property label="正文"><code>{project.contentDirectories.post}</code></Property><Property label="草稿"><code>{project.contentDirectories.draft}</code></Property><Property label="AI 日报"><code>{project.contentDirectories['ai-daily']}</code></Property></dl> : <div className="settings-no-project"><FolderOpen size={25} /><p>选择博客目录后查看项目配置。</p><Button onClick={onOpenProject} disabled={busy}>打开项目</Button></div>}</section>
    {project && <><section className="settings-section"><div className="settings-section-title"><div><h2>Git 信息</h2><p>来自本地仓库的只读信息。</p></div></div><dl className="settings-facts"><Property label="Git 可用">{project.git.available ? '可用' : '不可用'}</Property><Property label="仓库状态">{project.git.isRepository ? '已识别 Git 仓库' : '非 Git 仓库'}</Property><Property label="当前分支">{project.git.branch ?? '未识别'}</Property><Property label="远程地址"><code>{project.git.remote ?? '未配置'}</code></Property></dl>{project.git.error && <p className="settings-warning"><AlertCircle size={15} />{project.git.error}</p>}</section><section className="settings-section"><div className="settings-section-title"><div><h2>项目脚本</h2><p>读取自 package.json。本地预览会执行 dev，不会在这里改写脚本。</p></div><Badge>只读</Badge></div>{Object.keys(project.scripts).length ? <dl className="script-list">{Object.entries(project.scripts).map(([name, command]) => <div key={name}><dt>{name}</dt><dd><code>{command}</code></dd></div>)}</dl> : <p className="muted">未声明脚本</p>}</section>{(project.warnings.length > 0 || issues.length > 0) && <section className="settings-section"><div className="settings-section-title"><div><h2>读取提示</h2><p>修正文件后刷新内容库以重新检查。</p></div><Badge tone="warning">{project.warnings.length + issues.length} 项</Badge></div><ul className="settings-issues">{project.warnings.map((warning, idx) => <li key={`project-${idx}`}><AlertCircle size={16} /><p>{warning}</p></li>)}{issues.map((issue, idx) => <li key={`file-${idx}`}><AlertCircle size={16} /><div><code>{issue.path}</code><p>{issue.message}</p></div></li>)}</ul></section>}</>}
  </div></main>
}

export default App
