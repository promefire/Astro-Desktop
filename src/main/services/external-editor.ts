import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { ExternalEditorStatus } from '../../shared/contracts'
import { ServiceError } from './errors'

const EXTENSIONS = ['.md', '.mdx'] as const
type ArticleExtension = typeof EXTENSIONS[number]
export type RegistryQuery = (key: string, valueName: string | null) => Promise<string | null>
export type DefaultPathOpener = (articlePath: string) => Promise<string>

const run = promisify(execFile)

function registryTool(): string {
  const root = process.env.SystemRoot
  if (!root || !path.win32.isAbsolute(root) || root.includes('..') || /[%\0\r\n"&|<>^!]/.test(root)) {
    throw new ServiceError('EDITOR_NOT_FOUND', '未找到 Windows 注册表工具，无法检查默认打开方式。')
  }
  const command = path.win32.join(root, 'System32', 'reg.exe')
  if (!command.toLowerCase().endsWith('\\system32\\reg.exe')) {
    throw new ServiceError('EDITOR_NOT_FOUND', '未找到 Windows 注册表工具，无法检查默认打开方式。')
  }
  return command
}

export function readAssociationValue(stdout: string): string | null {
  const match = stdout.match(/REG_SZ[ \t]+([^\r\n]+)/)
  const value = match?.[1]?.trim()
  if (!value || value.length > 260 || /[\0\r\n]/.test(value)) return null
  if (/^\(.*\)$/.test(value)) return null
  return value
}

async function queryRegistry(key: string, valueName: string | null): Promise<string | null> {
  const args = valueName ? ['query', key, '/v', valueName] : ['query', key, '/ve']
  try {
    const { stdout } = await run(registryTool(), args, { windowsHide: true, timeout: 5000, shell: false })
    return readAssociationValue(stdout)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
    if (code === 'ENOENT') throw new ServiceError('EDITOR_NOT_FOUND', '未找到 Windows 注册表工具，无法检查默认打开方式。')
    if (status === 1) return null
    throw new ServiceError('EDITOR_LAUNCH_FAILED', '无法检查默认打开方式。')
  }
}

function userChoiceKey(extension: ArticleExtension): string {
  return `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}\\UserChoice`
}

export async function inspectDefaultEditors(query: RegistryQuery = queryRegistry): Promise<ExternalEditorStatus> {
  const associations: ExternalEditorStatus['associations'] = { '.md': 'missing', '.mdx': 'missing' }
  for (const extension of EXTENSIONS) {
    const chosen = await query(userChoiceKey(extension), 'ProgId') ?? await query(`HKCR\\${extension}`, null)
    associations[extension] = chosen ? 'ready' : 'missing'
  }
  const describe = (extension: ArticleExtension) => associations[extension] === 'ready' ? `已设置 ${extension} 的默认打开方式。` : `尚未设置 ${extension} 的默认打开方式。`
  return { associations, message: `${describe('.md')}${describe('.mdx')}打开文章时直接使用对应类型的系统默认程序，不需要在客户端里选择编辑器。` }
}

export function associationExtension(articlePath: string): ArticleExtension {
  const extension = path.win32.extname(articlePath).toLowerCase()
  if (extension !== '.md' && extension !== '.mdx') throw new ServiceError('UNSUPPORTED_CONTENT', '只能用默认程序打开 Markdown 或 MDX 文章。')
  return extension
}

export async function openWithDefaultApp(articlePath: string, openPath: DefaultPathOpener): Promise<void> {
  if (!path.win32.isAbsolute(articlePath) || /[\0\r\n"]/.test(articlePath)) {
    throw new ServiceError('EDITOR_INVALID', '文章路径无效，已取消打开外部编辑器。')
  }
  const extension = associationExtension(articlePath)
  let result: string
  try { result = await openPath(articlePath) }
  catch (error) { throw new ServiceError('EDITOR_LAUNCH_FAILED', `无法用默认程序打开文章：${error instanceof Error ? error.message : '启动失败。'}`) }
  if (!result) return
  if (/no application is associated|没有应用程序|没有关联/i.test(result)) {
    throw new ServiceError('EDITOR_NOT_FOUND', `尚未为 ${extension} 设置默认打开方式。请在 Windows 的默认应用中选择程序后再试。`)
  }
  throw new ServiceError('EDITOR_LAUNCH_FAILED', `无法用默认程序打开文章：${result.replace(/[\r\n]/g, ' ').slice(0, 300)}`)
}

export function missingAssociationMessage(extension: ArticleExtension): string {
  return `尚未为 ${extension} 设置默认打开方式。请在 Windows 的默认应用中选择程序后再试。`
}
