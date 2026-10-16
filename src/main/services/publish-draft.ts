import type { ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, contentKind } from '../adapters/promefire'
import { ServiceError } from './errors'
import { moveArticle, type MoveHooks, type MoveResult } from './article-move'

const DRAFT_ROOT = `${CONTENT_DIRECTORIES.draft}/`
const PUBLISH_DIRECTION = {
  action: '发布', sourceWord: '草稿', targetWord: '正文', done: '已转入正文', targetKind: 'post',
  conflictCode: 'PUBLISH_CONFLICT', interruptedCode: 'PUBLISH_INTERRUPTED', failedCode: 'PUBLISH_FAILED', unsafeCode: 'UNSAFE_PUBLISH',
} as const

export function publishInput(project: ProjectInfo, value: unknown): { relativePath: string; baseRevision: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_PUBLISH', '发布参数无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['projectPath', 'relativePath', 'baseRevision'].includes(key))) throw new ServiceError('INVALID_PUBLISH', '发布只接受当前草稿的路径和版本。')
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，没有移动文件。')
  if (typeof input.relativePath !== 'string' || typeof input.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new ServiceError('INVALID_PUBLISH', '发布参数无效。')
  if (contentKind(input.relativePath) !== 'draft') throw new ServiceError('NOT_A_DRAFT', '只有 src/contents/drafts 中的文章可以发布到正文。')
  return { relativePath: input.relativePath, baseRevision: input.baseRevision }
}

export async function publishDraft(project: ProjectInfo, value: unknown, moveRecovery: (from: string, to: string) => Promise<void>, hooks: MoveHooks = {}): Promise<MoveResult> {
  const input = publishInput(project, value)
  if (!input.relativePath.startsWith(DRAFT_ROOT)) throw new ServiceError('NOT_A_DRAFT', '只有草稿目录中的文章可以发布到正文。')
  return moveArticle(project, {
    sourceRelative: input.relativePath,
    targetRelative: `${CONTENT_DIRECTORIES.post}/${input.relativePath.slice(DRAFT_ROOT.length)}`,
    baseRevision: input.baseRevision,
  }, PUBLISH_DIRECTION, moveRecovery, hooks)
}
