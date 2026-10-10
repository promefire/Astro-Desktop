import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { FileStatus, GitInfo } from '../../shared/contracts'
import { isWithin } from './paths'

const execute = promisify(execFile)
const git = async (root: string, args: string[]) => (await execute('git', ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
  timeout: 8000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
})).stdout.trimEnd()

export function redactRemote(remote: string): string {
  try {
    const parsed = new URL(remote)
    if (parsed.username || parsed.password) { parsed.username = 'redacted'; parsed.password = '' }
    parsed.search = ''; parsed.hash = ''
    return parsed.toString()
  } catch {
    return remote.replace(/(https?:\/\/)[^\s/]*@/gi, '$1redacted@').replace(/[?#].*$/, '')
  }
}

export function parseGitStatus(output: string): Map<string, FileStatus> {
  const files = new Map<string, FileStatus>()
  const records = output.split('\0')
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record.length < 4) continue
    const status = record.slice(0, 2)
    const file = record.slice(3).replaceAll('\\', '/')
    let mapped: FileStatus = 'modified'
    if (status.includes('U') || status === 'AA' || status === 'DD') mapped = 'conflict'
    else if (status === '??') mapped = 'untracked'
    else if (status === '!!') mapped = 'ignored'
    else if (status.includes('A')) mapped = 'added'
    files.set(file, mapped)
    if (status.includes('R') || status.includes('C')) index++ // porcelain -z puts destination first, source second
  }
  return files
}

export async function readGit(root: string): Promise<{ info: GitInfo; statuses: Map<string, FileStatus>; statusAvailable: boolean }> {
  const info: GitInfo = { available: true, isRepository: false, branch: null, remote: null, error: null }
  try {
    const top = await git(root, ['rev-parse', '--show-toplevel'])
    info.isRepository = true
    const [branch, remote, statuses] = await Promise.allSettled([
      git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(async () => `detached:${await git(root, ['rev-parse', '--short', 'HEAD'])}`),
      git(root, ['remote', 'get-url', 'origin']),
      git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=all', '--', 'src/contents/post', 'src/contents/ai-daily']),
    ])
    if (branch.status === 'fulfilled') info.branch = branch.value
    if (remote.status === 'fulfilled') info.remote = redactRemote(remote.value)
    const mapped = new Map<string, FileStatus>()
    if (statuses.status === 'fulfilled') {
      for (const [relative, status] of parseGitStatus(statuses.value)) {
        const absolute = path.resolve(top, relative)
        if (isWithin(root, absolute)) mapped.set(path.relative(root, absolute).replaceAll('\\', '/'), status)
      }
    } else info.error = '无法读取 Git 文件状态；文章仍可读取。'
    return { info, statuses: mapped, statusAvailable: statuses.status === 'fulfilled' }
  } catch (error) {
    info.available = !(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
    info.error = info.available ? '该目录不是可访问的 Git 仓库；文章仍可读取。' : '未找到 Git；文章仍可读取，无法显示分支和文件状态。'
    return { info, statuses: new Map(), statusAvailable: false }
  }
}
