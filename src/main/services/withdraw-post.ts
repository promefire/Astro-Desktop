import type { ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, contentKind } from '../adapters/promefire'
import { ServiceError } from './errors'
import { moveArticle, type MoveHooks, type MoveResult } from './article-move'

const POST_ROOT = `${CONTENT_DIRECTORIES.post}/`
const WITHDRAW_DIRECTION = {
  action: '撤回', sourceWord: '正文', targetWord: '草稿', done: '已撤回为草稿', targetKind: 'draft',
  conflictCode: 'WITHDRAW_CONFLICT', interruptedCode: 'WITHDRAW_INTERRUPTED', failedCode: 'WITHDRAW_FAILED', unsafeCode: 'UNSAFE_WITHDRAW',
} as const

export function withdrawInput(project: ProjectInfo, value: unknown): { relativePath: string; baseRevision: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_WITHDRAW', '撤回参数无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['projectPath', 'relativePath', 'baseRevision'].includes(key))) throw new ServiceError('INVALID_WITHDRAW', '撤回只接受当前正文的路径和版本。')
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，没有移动文件。')
  if (typeof input.relativePath !== 'string' || typeof input.baseRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new ServiceError('INVALID_WITHDRAW', '撤回参数无效。')
  if (contentKind(input.relativePath) !== 'post') throw new ServiceError('NOT_A_POST', '只有 src/contents/post 中的正文可以撤回为草稿。')
  return { relativePath: input.relativePath, baseRevision: input.baseRevision }
}

export async function withdrawPost(project: ProjectInfo, value: unknown, moveRecovery: (from: string, to: string) => Promise<void>, hooks: MoveHooks = {}): Promise<MoveResult> {
  const input = withdrawInput(project, value)
  if (!input.relativePath.startsWith(POST_ROOT)) throw new ServiceError('NOT_A_POST', '只有正文目录中的文章可以撤回为草稿。')
  return moveArticle(project, {
    sourceRelative: input.relativePath,
    targetRelative: `${CONTENT_DIRECTORIES.draft}/${input.relativePath.slice(POST_ROOT.length)}`,
    baseRevision: input.baseRevision,
  }, WITHDRAW_DIRECTION, moveRecovery, hooks)
}
