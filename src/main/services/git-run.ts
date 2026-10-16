import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ServiceError } from './errors'

const execute = promisify(execFile)

export interface GitRunOptions {
  /**
   * 拉取和推送需要系统凭据管理器或 SSH agent 接管认证，所以不能像只读命令那样
   * 禁止交互提示；只读命令保持禁止，避免后台扫描弹出凭据窗口。
   */
  credentials?: boolean
  timeoutMs?: number
}

/**
 * The only place the app runs Git. Arguments are passed as an array and never through a shell,
 * so a path or message cannot inject another command. No command here opens an editor:
 * pull and commit always carry --no-edit or -m.
 */
export async function runGit(root: string, args: string[], options: GitRunOptions = {}): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  if (options.credentials) delete env.GIT_TERMINAL_PROMPT
  else env.GIT_TERMINAL_PROMPT = '0'
  try {
    const { stdout } = await execute('git', ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
      timeout: options.timeoutMs ?? 8000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env,
    })
    return stdout.trimEnd()
  } catch (error) {
    throw new ServiceError('GIT_COMMAND_FAILED', gitFailureMessage(args, error))
  }
}

/** Turn a Git failure into the most useful line Git printed, without leaking the environment. */
function gitFailureMessage(args: string[], error: unknown): string {
  const failed = error as { stderr?: string | Buffer; stdout?: string | Buffer; code?: string | number; killed?: boolean }
  if (failed?.killed) return `git ${args[0]} 超时，已停止。请检查网络后重试。`
  const stderr = typeof failed?.stderr === 'string' ? failed.stderr : Buffer.isBuffer(failed?.stderr) ? failed.stderr.toString('utf8') : ''
  const stdout = typeof failed?.stdout === 'string' ? failed.stdout : Buffer.isBuffer(failed?.stdout) ? failed.stdout.toString('utf8') : ''
  const lines = `${stderr}\n${stdout}`.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !/^hint:/i.test(line) && !/^warning:/i.test(line))
  const detail = lines.filter(line => !/^git: /.test(line)).slice(-3).join('；') || lines[0] || ''
  if (failed?.code === 'ENOENT') return '未找到 Git 命令。请先安装 Git 并让它出现在 PATH 中。'
  const label = args[0] === 'push' ? '推送' : args[0] === 'pull' ? '拉取' : args[0] === 'commit' ? '提交' : 'Git 命令'
  return detail ? `${label}失败：${detail}` : `${label}失败，Git 没有返回可读的原因。`
}

export function isGitMissing(error: unknown): boolean {
  return error instanceof ServiceError && error.message.includes('未找到 Git')
}
