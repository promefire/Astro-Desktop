/** Phase 2+ design contracts only. These capabilities are deliberately absent from IPC and UI. */
import type { ArticleDocument, ProjectInfo } from './contracts'

export interface ContentWriteService {
  // Ordinary draft creation and permanent article deletion are on DesktopApi.
  // Trash and restore are not implemented.
  // No AI daily creation or dedicated authoring form is planned.
  // Source saving and editor recovery are implemented in DesktopApi.
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
export interface AstroProcessService {
  /** Local preview start, stop, and article URLs are implemented on DesktopApi. Production build is not. */
  build(project: ProjectInfo): Promise<{ success: boolean; logPath: string }>
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
