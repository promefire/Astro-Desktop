export type ContentKind = 'post' | 'ai-daily'
export type Theme = 'light' | 'dark' | 'system'
export type FileStatus = 'clean' | 'modified' | 'added' | 'untracked' | 'conflict' | 'ignored' | 'unknown'
export interface RecentProject { path: string; name: string; lastOpened: string }
export interface AppSettings { version: 1; theme: Theme; recentProjects: RecentProject[]; lastProjectPath: string | null }
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
  saveArticle(input: EditorBuffer): Promise<Result<SaveArticleResult>>;
  checkpointEditor(input: EditorBuffer): Promise<Result<EditorRecovery>>;
  getEditorRecovery(input: ArticleTarget): Promise<Result<EditorRecovery | null>>;
  clearEditorRecovery(input: ArticleTarget): Promise<Result<void>>;
  listEditorRecoveries(): Promise<Result<RecoveryIndex>>;
  exportEditorCopy(input: { source: string; suggestedName: string }): Promise<Result<string | null>>;
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
  createDraft: 'content:create-draft',
  saveArticle: 'content:save', checkpointEditor: 'editor:checkpoint', getEditorRecovery: 'editor:recovery',
  clearEditorRecovery: 'editor:clear-recovery', listEditorRecoveries: 'editor:list-recoveries',
  setEditorDirty: 'editor:dirty', closeRequested: 'window:close-requested', closeWindow: 'window:close',
  exportEditorCopy: 'editor:export-copy',
} as const
