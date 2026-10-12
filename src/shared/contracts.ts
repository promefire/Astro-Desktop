export type ContentKind = 'post' | 'draft' | 'ai-daily'
export type Theme = 'light' | 'dark' | 'system'
export type FileStatus = 'clean' | 'modified' | 'added' | 'untracked' | 'conflict' | 'ignored' | 'unknown'
export interface RecentProject { path: string; name: string; lastOpened: string }
export interface ExternalEditorStatus { associations: Record<'.md' | '.mdx', 'ready' | 'missing'>; message: string }
export interface OpenExternalEditorResult { articlePath: string }
export interface PreviewRuntimeSetting { nodePath: string | null; npmPath: string | null }
export type PreviewPhase = 'idle' | 'checking' | 'starting' | 'running' | 'stopping' | 'failed'
export interface PreviewCheck { id: 'node' | 'npm' | 'script' | 'dependencies'; status: 'ok' | 'missing'; label: string; detail: string; suggestion: string }
export interface PreviewRuntimeInfo { nodePath: string; npmPath: string; nodeVersion: string; npmVersion: string; source: 'configured' | 'detected' }
export interface PreviewState { projectPath: string | null; phase: PreviewPhase; url: string | null; message: string; log: string; exitCode: number | null; checks: PreviewCheck[]; runtime: PreviewRuntimeInfo | null }
export interface PreviewArticleResult { kind: 'opened' | 'unresolved'; url: string | null; homepage: string | null; message: string }
export interface AppSettings { version: 1; theme: Theme; recentProjects: RecentProject[]; lastProjectPath: string | null; previewRuntime: PreviewRuntimeSetting }
export interface GitInfo { available: boolean; isRepository: boolean; branch: string | null; remote: string | null; error: string | null }
export interface ProjectInfo {
  name: string; path: string; adapter: 'promefire-astro-blog'; astroVersion: string;
  packageManager: string | null; scripts: Record<string, string>; git: GitInfo;
  contentDirectories: Record<ContentKind, string>; warnings: string[];
}
export interface Article {
  id: string; relativePath: string; kind: ContentKind; extension: '.md' | '.mdx';
  title: string; published: string | null; category: string | null; tags: string[];
  draft: boolean | null; description: string; summary: string; highlights: string[]; tools: string[];
  top: number | null; modifiedAt: string; size: number; fileStatus: FileStatus; issues: string[];
}
export interface ScanIssue { path: string; message: string }
export interface ContentIndex { articles: Article[]; issues: ScanIssue[]; scannedAt: string }
export interface ArticleDocument { article: Article; source: string; body: string; frontmatter: Record<string, unknown>; revision: string }
export interface CreateDraftInput {
  projectPath: string; title: string; tags: string[]; category: string; description: string;
}
export interface ArticleTarget { projectPath: string; relativePath: string }
export interface EditorBuffer extends ArticleTarget { source: string; baseRevision: string }
export interface EditorRecovery extends EditorBuffer { updatedAt: string }
export interface RecoveryIndex { entries: Array<ArticleTarget & { updatedAt: string }>; issues: string[] }
export interface SaveArticleResult { document: ArticleDocument; recoveryWarning: string | null }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code: string }
export interface DesktopApi {
  getSettings(): Promise<Result<AppSettings>>;
  setTheme(theme: Theme): Promise<Result<AppSettings>>;
  forgetProject(path: string): Promise<Result<AppSettings>>;
  selectProject(): Promise<Result<ProjectInfo | null>>;
  openRecentProject(path: string): Promise<Result<ProjectInfo>>;
  getProject(): Promise<Result<ProjectInfo | null>>;
  refreshProject(): Promise<Result<ProjectInfo>>;
  listArticles(): Promise<Result<ContentIndex>>;
  readArticle(relativePath: string): Promise<Result<ArticleDocument>>;
  createDraft(input: CreateDraftInput): Promise<Result<ArticleDocument>>;
  deleteArticle(input: ArticleTarget): Promise<Result<{ relativePath: string }>>;
  saveArticle(input: EditorBuffer): Promise<Result<SaveArticleResult>>;
  checkpointEditor(input: EditorBuffer): Promise<Result<EditorRecovery>>;
  getEditorRecovery(input: ArticleTarget): Promise<Result<EditorRecovery | null>>;
  clearEditorRecovery(input: ArticleTarget): Promise<Result<void>>;
  listEditorRecoveries(): Promise<Result<RecoveryIndex>>;
  exportEditorCopy(input: { source: string; suggestedName: string }): Promise<Result<string | null>>;
  checkExternalEditor(): Promise<Result<ExternalEditorStatus>>;
  openExternalEditor(input: ArticleTarget): Promise<Result<OpenExternalEditorResult>>;
  getPreview(): Promise<Result<PreviewState>>;
  checkPreview(): Promise<Result<PreviewState>>;
  startPreview(): Promise<Result<PreviewState>>;
  stopPreview(): Promise<Result<PreviewState>>;
  choosePreviewRuntime(): Promise<Result<PreviewState | null>>;
  clearPreviewRuntime(): Promise<Result<PreviewState>>;
  openPreviewHome(): Promise<Result<{ url: string }>>;
  openPreviewArticle(input: ArticleTarget): Promise<Result<PreviewArticleResult>>;
  onPreviewState(listener: (state: PreviewState) => void): () => void;
  setEditorDirty(dirty: boolean): void;
  onCloseRequested(listener: () => void): () => void;
  closeWindow(): Promise<Result<void>>;
  revealArticle(relativePath: string): Promise<Result<void>>;
  openProjectFolder(): Promise<Result<void>>;
}
export const IPC = {
  getSettings: 'settings:get', setTheme: 'settings:theme', forgetProject: 'settings:forget-project',
  selectProject: 'project:select', openRecentProject: 'project:open-recent', getProject: 'project:get',
  refreshProject: 'project:refresh', listArticles: 'content:list', readArticle: 'content:read',
  revealArticle: 'content:reveal', openProjectFolder: 'project:reveal',
  createDraft: 'content:create-draft', deleteArticle: 'content:delete',
  saveArticle: 'content:save', checkpointEditor: 'editor:checkpoint', getEditorRecovery: 'editor:recovery',
  clearEditorRecovery: 'editor:clear-recovery', listEditorRecoveries: 'editor:list-recoveries',
  setEditorDirty: 'editor:dirty', closeRequested: 'window:close-requested', closeWindow: 'window:close',
  exportEditorCopy: 'editor:export-copy',
  checkExternalEditor: 'editor:check-external', openExternalEditor: 'editor:open-external',
  getPreview: 'preview:status', checkPreview: 'preview:check', startPreview: 'preview:start', stopPreview: 'preview:stop',
  choosePreviewRuntime: 'preview:choose-runtime', clearPreviewRuntime: 'preview:clear-runtime',
  openPreviewHome: 'preview:open-home', openPreviewArticle: 'preview:open-article', previewState: 'preview:state',
} as const
