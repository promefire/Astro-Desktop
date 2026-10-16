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
/**
 * Git 同步已按用户选择的简化流程实现（拉取 → 列出改动 → 提交并推送），见 DesktopApi 的
 * pullRemote / pushChanges。下面这些更细的能力被明确取消，不保留占位接口：
 * 按文件选择性暂存、应用内解决合并冲突、构建校验、部署回执。
 */
export interface GitAdvancedService {
  diff(relativePaths: string[]): Promise<string>
  commit(input: { selectedPaths: string[]; message: string }): Promise<{ commit: string }>
  integrate(): Promise<{ status: 'integrated' | 'conflict'; conflictPaths: string[] }>
}
