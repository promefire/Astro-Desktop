import { mkdir, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppSettings, Theme } from '../../shared/contracts'
import { ServiceError, errorMessage, isMissing } from './errors'
import { readBounded } from './paths'

function defaults(): AppSettings { return { version: 1, theme: 'system', recentProjects: [], lastProjectPath: null } }
function clone(settings: AppSettings): AppSettings { return structuredClone(settings) }
function validate(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') throw new Error('设置格式必须为对象')
  const v = value as AppSettings
  if (v.version !== 1 || !['light', 'dark', 'system'].includes(v.theme) || !Array.isArray(v.recentProjects) || v.recentProjects.length > 10 ||
      !(v.lastProjectPath === null || typeof v.lastProjectPath === 'string')) throw new Error('设置版本或字段不受支持')
  for (const project of v.recentProjects) {
    if (!project || typeof project.path !== 'string' || !path.isAbsolute(project.path) || typeof project.name !== 'string' || typeof project.lastOpened !== 'string' || Number.isNaN(Date.parse(project.lastOpened))) {
      throw new Error('最近项目记录无效')
    }
  }
  if (v.lastProjectPath !== null && !v.recentProjects.some((p) => p.path === v.lastProjectPath)) throw new Error('最近项目与恢复记录不一致')
  return { version: 1, theme: v.theme, recentProjects: v.recentProjects.map((p) => ({ path: p.path, name: p.name, lastOpened: p.lastOpened })), lastProjectPath: v.lastProjectPath }
}

export function createSettingsService(settingsFile: string) {
  let current: AppSettings | null = null
  let queue: Promise<unknown> = Promise.resolve()
  async function load(): Promise<AppSettings> {
    if (current) return current
    try {
      current = validate(JSON.parse((await readBounded(settingsFile, 128 * 1024)).text))
      return current
    } catch (error) {
      if (isMissing(error)) return (current = defaults())
      throw new ServiceError('SETTINGS_CORRUPT', `无法读取设置文件，原文件已保留：${settingsFile}。${errorMessage(error)}`)
    }
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }
  async function persist(next: AppSettings): Promise<AppSettings> {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    const temporary = `${settingsFile}.${randomUUID()}.tmp`
    try {
      const file = await open(temporary, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(next, null, 2), 'utf8'); await file.sync() } finally { await file.close() }
      await rename(temporary, settingsFile)
      current = next
      return clone(next)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw new ServiceError('SETTINGS_WRITE_FAILED', `设置保存失败：${errorMessage(error)}`)
    }
  }
  return {
    get: () => serial(async () => clone(await load())),
    setTheme: (theme: Theme) => serial(async () => {
      if (!['light', 'dark', 'system'].includes(theme)) throw new ServiceError('INVALID_THEME', '不支持的主题。')
      return persist({ ...await load(), theme })
    }),
    forgetProject: (projectPath: string) => serial(async () => {
      const settings = await load()
      return persist({ ...settings, recentProjects: settings.recentProjects.filter((p) => p.path !== projectPath), lastProjectPath: settings.lastProjectPath === projectPath ? null : settings.lastProjectPath })
    }),
    rememberProject: (projectPath: string, name: string) => serial(async () => {
      const settings = await load()
      return persist({ ...settings, recentProjects: [{ path: projectPath, name, lastOpened: new Date().toISOString() }, ...settings.recentProjects.filter((p) => p.path !== projectPath)].slice(0, 10), lastProjectPath: projectPath })
    }),
  }
}
