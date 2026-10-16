import type { FileStatus, ProjectInfo, PushResult, SyncChange, SyncSnapshot } from '../../shared/contracts'
import { ServiceError } from './errors'
import { isGitMissing, runGit } from './git-run'

const PULL_TIMEOUT = 120_000
const PUSH_TIMEOUT = 120_000
const LOCAL_TIMEOUT = 30_000
const MESSAGE_LIMIT = 200

/** Pending-push status for one file. Unlike the per-article badge this also reports deletions. */
function changeStatus(code: string): FileStatus {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflict'
  if (code === '??') return 'untracked'
  if (code === '!!') return 'ignored'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A') || code.includes('R') || code.includes('C')) return 'added'
  return 'modified'
}

/** Whole-repository status. The article badges stay scoped to content directories; this list is what `git add .` would stage. */
export function parseRepoChanges(output: string): SyncChange[] {
  const records = output.split('\0')
  const changes: SyncChange[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    const path = record.slice(3).replaceAll('\\', '/')
    changes.push({ path, status: changeStatus(code) })
    // porcelain -z lists the destination first, then the source of a rename or copy.
    if (code.includes('R') || code.includes('C')) index++
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

async function optional(root: string, args: string[]): Promise<string | null> {
  try { return await runGit(root, args) } catch { return null }
}

/**
 * The remote and branch to pull from and push to: the configured upstream when there is one,
 * otherwise origin plus the current branch. This blog keeps origin on GitHub while the server
 * commits AI reports there, so a merge (never a rebase or a force push) is what we ask for.
 */
async function target(project: ProjectInfo): Promise<{ remote: string; branch: string; upstream: string | null }> {
  const upstream = await optional(project.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const branch = await optional(project.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branch || branch === 'HEAD') throw new ServiceError('GIT_DETACHED', '当前不在任何分支上，请先切换到一个分支再推送。')
  if (upstream?.includes('/')) {
    const [remote, ...rest] = upstream.split('/')
    return { remote, branch: rest.join('/'), upstream }
  }
  const origin = await optional(project.path, ['remote', 'get-url', 'origin'])
  if (!origin) throw new ServiceError('GIT_NO_REMOTE', '这个仓库没有配置 origin 远程地址，无法拉取或推送。')
  return { remote: 'origin', branch, upstream: null }
}

export async function readSyncSnapshot(project: ProjectInfo, message: string): Promise<SyncSnapshot> {
  await assertRepository(project)
  const { remote, branch, upstream } = await target(project)
  const [status, identity, counts, remoteUrl] = await Promise.all([
    runGit(project.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    Promise.all([optional(project.path, ['config', 'user.name']), optional(project.path, ['config', 'user.email'])]),
    count(project.path, remote, branch),
    optional(project.path, ['remote', 'get-url', remote]),
  ])
  return {
    branch, remote, upstream,
    changes: parseRepoChanges(status),
    ahead: counts.ahead, behind: counts.behind,
    identity: { name: identity[0], email: identity[1] },
    message,
  }
}

/** A directory that is not a repository has to be reported as such, not as a detached HEAD. */
async function assertRepository(project: ProjectInfo): Promise<void> {
  const info = await runGit(project.path, ['rev-parse', '--is-inside-work-tree']).catch(error => { if (isGitMissing(error)) throw error; return null })
  if (!info) throw new ServiceError('GIT_NOT_REPOSITORY', '当前项目不是 Git 仓库，无法同步。')
}

/** Behind is how many remote commits are missing locally, ahead is how many local commits are not pushed. */
async function count(root: string, remote: string, branch: string): Promise<{ ahead: number; behind: number }> {
  const output = await optional(root, ['rev-list', '--left-right', '--count', `${remote}/${branch}...HEAD`])
  if (output) {
    const [behind, ahead] = output.split(/\s+/).map(value => Number.parseInt(value, 10))
    return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 }
  }
  // 远端还没有这个分支：本地已有的提交全都算待推送。
  const local = await optional(root, ['rev-list', '--count', 'HEAD'])
  return { ahead: Number.parseInt(local ?? '0', 10) || 0, behind: 0 }
}

/**
 * Pull before showing the file list, so the list describes the state the push will actually start from.
 * A failed pull stops here: committing a half-merged tree is worse than refusing to continue.
 */
export function assertSyncTarget(project: ProjectInfo, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_SYNC', '同步参数无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => key !== 'projectPath')) throw new ServiceError('INVALID_SYNC', '同步只接受当前项目。')
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，没有同步。')
}

export async function pullRemote(project: ProjectInfo, value: unknown): Promise<SyncSnapshot> {
  assertSyncTarget(project, value)
  await assertRepository(project)
  const { remote, branch } = await target(project)
  await runGit(project.path, ['pull', '--no-rebase', '--no-edit', remote, branch], { credentials: true, timeoutMs: PULL_TIMEOUT })
  return readSyncSnapshot(project, '已拉取远程仓库。确认文件列表和提交信息后推送。')
}

export function pushInput(project: ProjectInfo, value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_PUSH', '推送参数无效。')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => key !== 'projectPath' && key !== 'message')) throw new ServiceError('INVALID_PUSH', '推送只接受当前项目和提交信息。')
  if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，没有推送。')
  if (typeof input.message !== 'string') throw new ServiceError('INVALID_PUSH', '提交信息无效。')
  const message = input.message.trim()
  if (!message) throw new ServiceError('INVALID_PUSH', '请先填写提交信息。')
  if (message.length > MESSAGE_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) throw new ServiceError('INVALID_PUSH', `提交信息最多 ${MESSAGE_LIMIT} 个字符，且不能包含控制字符。`)
  return message
}

/**
 * 提交并推送当前分支：git add . → git commit -m → git push。不做选择性暂存，不建标签，
 * 不设置上游，也永不强制推送。已经处于冲突状态时直接拒绝，避免把冲突标记提交上去。
 */
export async function pushChanges(project: ProjectInfo, value: unknown): Promise<PushResult> {
  const message = pushInput(project, value)
  await assertRepository(project)
  const { remote, branch } = await target(project)
  const snapshot = await readSyncSnapshot(project, '')
  if (snapshot.changes.some(change => change.status === 'conflict')) {
    throw new ServiceError('GIT_CONFLICT_PENDING', '仓库里有未解决的合并冲突，请先在外部 Git 工具里解决后再推送。')
  }
  const staged = snapshot.changes.filter(change => change.status !== 'conflict')
  let commit: string | null = null
  if (staged.length > 0) {
    await runGit(project.path, ['add', '.'], { timeoutMs: LOCAL_TIMEOUT })
    await runGit(project.path, ['commit', '-m', message], { timeoutMs: LOCAL_TIMEOUT })
    commit = await runGit(project.path, ['rev-parse', '--short', 'HEAD'])
  } else if (snapshot.ahead === 0) {
    throw new ServiceError('NOTHING_TO_PUSH', '本地没有需要提交或推送的修改。')
  }
  await runGit(project.path, ['push', remote, branch], { credentials: true, timeoutMs: PUSH_TIMEOUT })
  return { commit, branch, message: commit ? `已推送 ${commit} 到 ${remote}/${branch}。` : `已把本地提交推送到 ${remote}/${branch}。` }
}
