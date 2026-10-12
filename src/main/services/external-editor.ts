import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ExternalEditorStatus } from '../../shared/contracts'
import { ServiceError, isMissing } from './errors'

const EXECUTABLES = new Set(['.exe', '.cmd', '.bat'])
const BLOCKED_HOSTS = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'bash.exe', 'wsl.exe', 'mshta.exe', 'rundll32.exe'])
const STARTED_PROCESS_GRACE_MS = 400

export interface ExternalEditorInvocation {
  file: string
  args: string[]
  options: SpawnOptions & { shell: false; windowsVerbatimArguments: boolean }
}

/** Quote one Windows argument. cmd.exe metacharacters stay inside the quotes. */
export function quoteCmdArgument(value: string): string {
  let quoted = '"'
  let slashes = 0
  for (const char of value) {
    if (char === '\\') { slashes += 1; continue }
    if (char === '"') quoted += `${'\\'.repeat(slashes * 2 + 1)}"`
    else quoted += '\\'.repeat(slashes) + char
    slashes = 0
  }
  return `${quoted}${'\\'.repeat(slashes * 2)}"`
}

export function assertEditorPathShape(editorPath: string): void {
  if (!editorPath || editorPath.length > 4096 || /[\0\r\n"]/.test(editorPath) || !path.win32.isAbsolute(editorPath)) {
    throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效。请选择完整的绝对路径。')
  }
  if (!EXECUTABLES.has(path.win32.extname(editorPath).toLowerCase())) {
    throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效。只能选择 .exe、.cmd 或 .bat。')
  }
}

export async function resolveEditorFile(editorPath: string): Promise<string> {
  assertEditorPathShape(editorPath)
  let resolved: string
  try { resolved = await realpath(editorPath) }
  catch (error) {
    if (isMissing(error)) throw new ServiceError('EDITOR_NOT_FOUND', '未安装外部编辑器，或配置的文件已不存在。')
    throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效，无法确认它是普通可执行文件。')
  }
  assertEditorPathShape(resolved)
  if (BLOCKED_HOSTS.has(path.win32.basename(resolved).toLowerCase())) {
    throw new ServiceError('EDITOR_INVALID', '不能把命令解释器配置为外部编辑器。请选择会打开文件的程序，例如 Code.exe。')
  }
  if (!(await stat(resolved)).isFile()) throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效，所选位置不是可执行文件。')
  return resolved
}

export async function inspectExternalEditor(editorPath: string | null): Promise<ExternalEditorStatus> {
  if (editorPath === null) return { path: null, state: 'unconfigured', message: '尚未配置外部编辑器。请在项目设置中选择本机的 .exe、.cmd 或 .bat。' }
  try {
    return { path: await resolveEditorFile(editorPath), state: 'ready', message: '已找到外部编辑器文件。' }
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法检查外部编辑器。'
    if (error instanceof ServiceError && error.code === 'EDITOR_NOT_FOUND') return { path: editorPath, state: 'missing', message }
    return { path: editorPath, state: 'invalid', message }
  }
}

function commandInterpreter(): string {
  const root = process.env.SystemRoot
  if (!root || !path.win32.isAbsolute(root) || root.includes('..') || /[%\0\r\n"&|<>^!]/.test(root)) {
    throw new ServiceError('EDITOR_LAUNCH_FAILED', '未找到 Windows 命令解释器，无法启动脚本型编辑器。请改用 .exe。')
  }
  const command = path.win32.join(root, 'System32', 'cmd.exe')
  if (!command.toLowerCase().endsWith('\\system32\\cmd.exe')) {
    throw new ServiceError('EDITOR_LAUNCH_FAILED', '未找到 Windows 命令解释器，无法启动脚本型编辑器。请改用 .exe。')
  }
  return command
}

function assertCmdSafe(value: string): void {
  if (/[%\r\n"]/.test(value)) {
    throw new ServiceError('EDITOR_UNSAFE_PATH', '路径包含 % 或引号，无法安全交给 .cmd / .bat。请改用 .exe 编辑器，或换用不含这些字符的路径。')
  }
}

export function externalEditorInvocation(editorPath: string, articlePath: string): ExternalEditorInvocation {
  assertEditorPathShape(editorPath)
  if (BLOCKED_HOSTS.has(path.win32.basename(editorPath).toLowerCase())) {
    throw new ServiceError('EDITOR_INVALID', '不能把命令解释器配置为外部编辑器。请选择会打开文件的程序，例如 Code.exe。')
  }
  if (!path.win32.isAbsolute(articlePath) || /[\0\r\n"]/.test(articlePath)) {
    throw new ServiceError('EDITOR_INVALID', '文章路径无效，已取消打开外部编辑器。')
  }
  const extension = path.win32.extname(editorPath).toLowerCase()
  const options = { shell: false as const, windowsHide: true, detached: true, stdio: 'ignore' as const }
  if (extension === '.cmd' || extension === '.bat') {
    if (process.platform !== 'win32') throw new ServiceError('EDITOR_LAUNCH_FAILED', '当前系统不能启动 .cmd / .bat 编辑器。请改用 .exe。')
    assertCmdSafe(editorPath)
    assertCmdSafe(articlePath)
    // /s strips one outer quote pair, so the script and article remain two quoted arguments.
    const command = `"${quoteCmdArgument(editorPath)} ${quoteCmdArgument(articlePath)}"`
    return { file: commandInterpreter(), args: ['/d', '/v:off', '/s', '/c', command], options: { ...options, windowsVerbatimArguments: true } }
  }
  return { file: editorPath, args: [articlePath], options: { ...options, windowsVerbatimArguments: false } }
}

export async function launchExternalEditor(editorPath: string, articlePath: string): Promise<void> {
  let editor: Awaited<ReturnType<typeof stat>>
  try { editor = await stat(editorPath) }
  catch (error) {
    if (isMissing(error)) throw new ServiceError('EDITOR_NOT_FOUND', '未安装外部编辑器，或配置的文件已不存在。')
    throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效，无法确认它是普通可执行文件。')
  }
  if (!editor.isFile()) throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效，所选位置不是可执行文件。')
  const invocation = externalEditorInvocation(editorPath, articlePath)
  if (invocation.options.windowsVerbatimArguments && !(await stat(invocation.file).catch(() => null))?.isFile()) {
    throw new ServiceError('EDITOR_LAUNCH_FAILED', '未找到 Windows 命令解释器，无法启动脚本型编辑器。请改用 .exe。')
  }
  await new Promise<void>((resolve, reject) => {
    let child
    try { child = spawn(invocation.file, invocation.args, invocation.options) }
    catch (error) { reject(new ServiceError('EDITOR_LAUNCH_FAILED', `外部编辑器启动失败：${error instanceof Error ? error.message : '无法创建进程。'}`)); return }
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.unref()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(), STARTED_PROCESS_GRACE_MS)
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish(new ServiceError(error.code === 'ENOENT' ? 'EDITOR_NOT_FOUND' : 'EDITOR_LAUNCH_FAILED', error.code === 'ENOENT' ? '未安装外部编辑器，或系统找不到该可执行文件。' : `外部编辑器启动失败：${error.message}`))
    })
    child.once('exit', code => {
      if (settled) return
      if (code === 0) finish()
      else finish(new ServiceError('EDITOR_LAUNCH_FAILED', `外部编辑器启动失败（退出码 ${code ?? '未知'}）。文章未被打开。`))
    })
  })
}
