import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { PreviewCheck, PreviewRuntimeSetting } from '../../shared/contracts'
import { ServiceError } from './errors'
import { readBounded, safePath } from './paths'

export interface CommandResult { stdout: string; stderr: string; code: number | null }
export type CommandRunner = (file: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; verbatim?: boolean }) => Promise<CommandResult>
export interface ResolvedRuntime { nodePath: string; npmPath: string; nodeVersion: string; npmVersion: string; source: 'configured' | 'detected' }

const DRIVE_PATH = /^[A-Za-z]:\\(?:[^<>:"|?*\u0000-\u001f%&\\^]+\\)*[^<>:"|?*\u0000-\u001f%&\\^]+$/

export function parseRegistryValue(output: string): string | null {
  const line = output.split(/\r?\n/).map(item => item.trim()).find(item => /\bREG_(?:EXPAND_)?SZ\b/.test(item) && !item.startsWith('HKEY'))
  const value = line?.match(/\bREG_(?:EXPAND_)?SZ\s+(.*)$/)?.[1]?.trim()
  if (!value || /^\(.*\)$/.test(value)) return null
  return value
}

export function expandWindowsVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (_, name: string) => {
    const key = Object.keys(env).find(item => item.toLowerCase() === String(name).toLowerCase())
    return key && env[key] !== undefined ? env[key] : ''
  })
}

export function splitPath(value: string): string[] {
  const entries: string[] = []
  for (const item of value.split(';')) {
    const trimmed = item.trim().replace(/[\\/]+$/, '')
    if (trimmed && !entries.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) entries.push(trimmed)
  }
  return entries
}

export function assertExecutablePath(file: string, kind: 'node' | 'npm'): void {
  const expected = kind === 'node' ? '\\node.exe' : '\\npm.cmd'
  if (!DRIVE_PATH.test(file) || !file.toLowerCase().endsWith(expected)) {
    throw new ServiceError('INVALID_RUNTIME', kind === 'node' ? '请选择本机的 node.exe，路径不能包含 %、& 或引号。' : '请选择与 Node 配套的 npm.cmd，路径不能包含 %、& 或引号。')
  }
}

export function npmDevCommand(npmPath: string): string {
  assertExecutablePath(npmPath, 'npm')
  return `""${npmPath}" run dev"`
}

export function previewChildEnv(source: NodeJS.ProcessEnv, nodeDirectory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key.toUpperCase().startsWith('ELECTRON_')) continue
    if (key === 'NODE_OPTIONS' && /electron/i.test(value)) continue
    env[key] = value
  }
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path'
  const current = env[pathKey] ?? ''
  env[pathKey] = current.toLowerCase().includes(nodeDirectory.toLowerCase()) ? current : `${nodeDirectory};${current}`
  env.ASTRO_TELEMETRY_DISABLED = '1'
  return env
}

export function spawnDevProcess(npmPath: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const command = path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'cmd.exe')
  return spawn(command, ['/d', '/s', '/c', npmDevCommand(npmPath)], {
    cwd, env, windowsHide: true, windowsVerbatimArguments: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export const defaultRunner: CommandRunner = (file, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { cwd: options.cwd, env: options.env, windowsHide: true, shell: false, windowsVerbatimArguments: options.verbatim === true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => { child.kill(); reject(new ServiceError('RUNTIME_TIMEOUT', '检查 Node 或 npm 超时。')) }, options.timeout ?? 8000)
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.on('error', (error) => { clearTimeout(timer); reject(error) })
  child.on('exit', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }) })
})

async function registryPath(run: CommandRunner, env: NodeJS.ProcessEnv): Promise<string[]> {
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  const reg = path.win32.join(root, 'System32', 'reg.exe')
  const queries = [
    ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path'],
    ['HKCU\\Environment', 'Path'],
  ] as const
  const values: string[] = []
  for (const [key, name] of queries) {
    try {
      const result = await run(reg, ['query', key, '/v', name], { timeout: 5000 })
      const parsed = result.code === 0 ? parseRegistryValue(result.stdout) : null
      if (parsed) values.push(expandWindowsVars(parsed, env))
    } catch { /* A missing registry value only means that source is unavailable. */ }
  }
  const processPath = env.Path || env.PATH || ''
  return splitPath([...values, processPath].join(';'))
}

async function describeNode(run: CommandRunner, nodePath: string, env: NodeJS.ProcessEnv): Promise<{ version: string } | string> {
  try {
    const result = await run(nodePath, ['-e', 'process.stdout.write(JSON.stringify({execPath:process.execPath,version:process.version,electron:process.versions.electron||null}))'], { env, timeout: 8000 })
    const parsed = JSON.parse(result.stdout) as { execPath?: unknown; version?: unknown; electron?: unknown }
    if (result.code !== 0 || typeof parsed.version !== 'string' || typeof parsed.execPath !== 'string') return '无法确认这是可用的 Node.js。'
    if (parsed.electron || path.win32.basename(parsed.execPath).toLowerCase().startsWith('electron')) return '检测到的是 Electron 自带运行时，不能当作已经安装系统 Node.js。'
    return { version: parsed.version }
  } catch {
    return '无法启动所选的 node.exe。'
  }
}

async function describeNpm(npmPath: string, env: NodeJS.ProcessEnv, cwd: string): Promise<string | string> {
  const root = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
  const command = path.win32.join(root, 'System32', 'cmd.exe')
  try {
    const result = await defaultRunner(command, ['/d', '/s', '/c', `""${npmPath}" --version"`], { cwd, env, timeout: 15000, verbatim: true })
    const version = result.stdout.trim()
    if (result.code !== 0 || !/^\d+\.\d+\.\d+/.test(version)) return 'npm.cmd 没有返回可用的版本号。'
    return version
  } catch {
    return '无法启动所选的 npm.cmd。'
  }
}

function check(id: PreviewCheck['id'], status: PreviewCheck['status'], label: string, detail: string, suggestion: string): PreviewCheck {
  return { id, status, label, detail, suggestion }
}

export async function inspectPreviewEnvironment(input: {
  projectPath: string
  configured: PreviewRuntimeSetting
  env?: NodeJS.ProcessEnv
  run?: CommandRunner
}): Promise<{ ok: boolean; runtime: ResolvedRuntime | null; checks: PreviewCheck[] }> {
  const env = input.env ?? process.env
  const run = input.run ?? defaultRunner
  const checks: PreviewCheck[] = []
  let nodePath = ''
  let npmPath = ''
  let source: 'configured' | 'detected' = 'detected'
  if (input.configured.nodePath || input.configured.npmPath) {
    source = 'configured'
    try {
      if (!input.configured.nodePath || !input.configured.npmPath) throw new ServiceError('INVALID_RUNTIME', 'Node 和 npm 需要同时选择。')
      assertExecutablePath(input.configured.nodePath, 'node')
      assertExecutablePath(input.configured.npmPath, 'npm')
      nodePath = input.configured.nodePath
      npmPath = input.configured.npmPath
    } catch (error) {
      const detail = error instanceof Error ? error.message : '已保存的 Node/npm 无效。'
      checks.push(check('node', 'missing', 'Node.js', detail, '请重新选择 node.exe 和 npm.cmd，或恢复自动检测。'))
    }
  } else {
    const entries = await registryPath(run, env)
    for (const directory of entries) {
      const candidate = path.win32.join(directory, 'node.exe')
      try { await access(candidate); nodePath = candidate; break } catch { /* Keep searching the real PATH. */ }
    }
    if (nodePath) {
      const sibling = path.win32.join(path.win32.dirname(nodePath), 'npm.cmd')
      try { await access(sibling); npmPath = sibling } catch { /* Reported by the npm check below. */ }
    }
  }
  if (!checks.some(item => item.id === 'node')) {
    if (!nodePath) checks.push(check('node', 'missing', 'Node.js', '没有在 Windows 的用户和系统 PATH 中找到 node.exe。', '安装 Node.js 后重新打开客户端，或在本地预览里手动选择 node.exe。客户端不会把 Electron 当作系统 Node。'))
    else {
      const described = await describeNode(run, nodePath, previewChildEnv(env, path.win32.dirname(nodePath)))
      if (typeof described !== 'object') checks.push(check('node', 'missing', 'Node.js', described, '请安装或选择系统 Node.js，而不是 Electron 的可执行文件。'))
      else checks.push(check('node', 'ok', 'Node.js', `${described.version} · ${nodePath}`, ''))
    }
  }
  if (!checks.some(item => item.id === 'npm')) {
    if (!npmPath) checks.push(check('npm', 'missing', 'npm', '没有找到与 Node 配套的 npm.cmd。', '请选择 npm.cmd。客户端使用 cmd.exe 参数数组启动它，不会拼接任意命令。'))
    else if (checks.some(item => item.id === 'node' && item.status === 'missing')) checks.push(check('npm', 'missing', 'npm', 'Node.js 不可用，因此没有继续检查 npm。', '先修正 Node.js，再检查 npm.cmd。'))
    else {
      const described = await describeNpm(npmPath, previewChildEnv(env, path.win32.dirname(nodePath)), input.projectPath)
      if (typeof described !== 'string' || described.includes('没有') || described.includes('无法')) checks.push(check('npm', 'missing', 'npm', described, '请选择能执行 --version 的 npm.cmd，或恢复自动检测。'))
      else checks.push(check('npm', 'ok', 'npm', `${described} · ${npmPath}`, ''))
    }
  }
  let devScript = false
  try {
    const manifest = JSON.parse((await readBounded(await safePath(input.projectPath, 'package.json'), 1024 * 1024)).text) as { scripts?: Record<string, unknown> }
    devScript = typeof manifest.scripts?.dev === 'string' && manifest.scripts.dev.trim().length > 0
  } catch { devScript = false }
  checks.push(devScript
    ? check('script', 'ok', 'dev 脚本', 'package.json 含有 dev 脚本，启动时会保留 predev 等前置步骤。', '')
    : check('script', 'missing', 'dev 脚本', 'package.json 没有可执行的 dev 脚本。', '请在博客项目中添加 dev 脚本后再试。客户端不会自动修改 package.json。'))
  let astroInstalled = false
  let astroDetail = '未找到 node_modules/astro。'
  try {
    const installed = JSON.parse((await readBounded(await safePath(input.projectPath, 'node_modules/astro/package.json'), 1024 * 1024)).text) as { name?: unknown; version?: unknown }
    if (installed.name === 'astro' && typeof installed.version === 'string') {
      astroInstalled = true
      astroDetail = `已安装 astro ${installed.version}。这只说明依赖存在，不代表预览已经就绪。`
    }
  } catch { /* Missing dependency is reported below. */ }
  checks.push(astroInstalled
    ? check('dependencies', 'ok', 'Astro 依赖', astroDetail, '')
    : check('dependencies', 'missing', 'Astro 依赖', astroDetail, '请在博客目录安装依赖后再试。客户端不会自动执行安装。'))
  const node = checks.find(item => item.id === 'node')
  const npm = checks.find(item => item.id === 'npm')
  const runtime = node?.status === 'ok' && npm?.status === 'ok' && node.detail.includes(' · ') && npm.detail.includes(' · ')
    ? { nodePath, npmPath, nodeVersion: node.detail.split(' · ')[0], npmVersion: npm.detail.split(' · ')[0], source }
    : null
  return { ok: checks.every(item => item.status === 'ok'), runtime, checks }
}
