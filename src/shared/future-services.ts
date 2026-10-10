/** Phase 2+ design contracts only. These capabilities are deliberately absent from IPC and UI. */
import type { ArticleDocument, ContentKind, ProjectInfo } from './contracts'

export interface ContentWriteService {
  create(input: { kind: ContentKind; relativePath: string; source: string }): Promise<ArticleDocument>
  /** Must refuse a save if the current file hash differs from expectedRevision. */
  save(input: { relativePath: string; source: string; expectedRevision: string }): Promise<ArticleDocument>
  trash(relativePath: string, expectedRevision: string): Promise<{ recoveryId: string }>
  restore(recoveryId: string): Promise<ArticleDocument>
}
export interface FrontmatterWriteService {
  /** Preserve unknown keys, comments, date style, line endings, and exact MDX body. */
  patch(source: string, changes: Record<string, unknown>): Promise<string>
}
export interface AssetService {
  importImage(input: { articlePath: string; sourcePath: string; alt: string }): Promise<{ relativePath: string; markdown: string }>
}
export interface EditorRecoveryService {
  checkpoint(input: { projectPath: string; relativePath: string; source: string; baseRevision: string }): Promise<void>
  recover(projectPath: string): Promise<Array<{ relativePath: string; source: string; baseRevision: string }>>
}
export interface AstroProcessService {
  /** Invoke the existing package.json script; never replace it with bare astro. */
  start(project: ProjectInfo, script: 'dev' | 'preview'): Promise<{ processId: string; url: string }>
  stop(ownedProcessId: string): Promise<void>
  build(project: ProjectInfo): Promise<{ success: boolean; logPath: string }>
  resolveArticleUrl(project: ProjectInfo, article: ArticleDocument): Promise<string>
}
export interface GitWriteService {
  diff(relativePaths: string[]): Promise<string>
  commit(input: { selectedPaths: string[]; message: string }): Promise<{ commit: string }>
  fetch(): Promise<void>
  integrate(): Promise<{ status: 'integrated' | 'conflict'; conflictPaths: string[] }>
  push(): Promise<{ commit: string }>
}
export type PublishState = 'validating' | 'committing' | 'fetching' | 'integrating' | 'conflict' | 'building' | 'pushing' | 'pushed-deployment-unconfirmed' | 'failed'
export interface PublishService {
  /** Explicit selected files, preserve remote AI reports, stop on conflicts/build failures. */
  publish(input: { selectedPaths: string[]; message: string }, onState: (state: PublishState) => void): Promise<{ commit: string; deployment: 'unconfirmed' }>
}
