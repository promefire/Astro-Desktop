import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'
import { inspectDefaultEditors, openWithDefaultApp, readAssociationValue, type RegistryQuery } from '../src/main/services/external-editor'
import type { ExternalEditorStatus } from '../src/shared/contracts'

let root: string, project: string, services: ReturnType<typeof createServices>
const relativePath = 'src/contents/post/测试.md'
const specialRelative = 'src/contents/post/a & b!.md'
const percentRelative = 'src/contents/post/100% ok.md'
const source = '---\r\ntitle: "外部编辑"\r\npublished: 2026-01-01\r\ndraft: true\r\n---\r\n正文\r\n'
const ready: ExternalEditorStatus = { associations: { '.md': 'ready', '.mdx': 'ready' }, message: '已设置' }
const missing: ExternalEditorStatus = { associations: { '.md': 'missing', '.mdx': 'missing' }, message: '尚未设置' }
const run = promisify(execFile)

async function fixture(directory: string) {
  await mkdir(path.join(directory, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(directory, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'astro-external-editor-'))
  project = path.join(root, '中文 博客')
  await fixture(project)
  await writeFile(path.join(project, relativePath), source)
  services = createServices(path.join(root, 'settings.json'))
  await services.projects.select(project)
})
afterEach(async () => {
  if (path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith('astro-external-editor-')) await rm(root, { recursive: true, force: true })
})

describe('default application lookup', () => {
  it('reads a ProgId and ignores an unset class default', () => {
    expect(readAssociationValue('    ProgId    REG_SZ    Typora.md\r\n')).toBe('Typora.md')
    expect(readAssociationValue('    ProgId    REG_SZ    Applications\\Typora.exe\r\n')).toBe('Applications\\Typora.exe')
    expect(readAssociationValue('    (默认)    REG_SZ    (值未设置)\r\n')).toBeNull()
    expect(readAssociationValue('    (Default)    REG_SZ    (value not set)\r\n')).toBeNull()
    expect(readAssociationValue('    (默认)    REG_SZ    mdx_auto_file\r\n')).toBe('mdx_auto_file')
  })
  it('prefers the user choice and does not treat a query as a successful open', async () => {
    const query: RegistryQuery = async (key) => {
      if (key.endsWith('\\.md\\UserChoice')) return 'Typora.md'
      if (key === 'HKCR\\.mdx') return 'mdx_auto_file'
      return null
    }
    const status = await inspectDefaultEditors(query)
    expect(status.associations).toEqual({ '.md': 'ready', '.mdx': 'ready' })
    expect(status.message).toContain('已设置 .md')
    expect(status.message).toContain('不需要在客户端里选择编辑器')
    const absent = await inspectDefaultEditors(async () => null)
    expect(absent.associations).toEqual({ '.md': 'missing', '.mdx': 'missing' })
    expect(absent.message).toContain('尚未设置 .md')
  })
  it('matches the current Windows user choice without launching a program', async () => {
    const reg = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
    const read = async (extension: '.md' | '.mdx') => {
      try {
        const { stdout } = await run(reg, ['query', `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${extension}\\UserChoice`, '/v', 'ProgId'], { windowsHide: true, shell: false })
        return readAssociationValue(stdout)
      } catch { return null }
    }
    const classDefault = async (extension: '.md' | '.mdx') => {
      try {
        const { stdout } = await run(reg, ['query', `HKCR\\${extension}`, '/ve'], { windowsHide: true, shell: false })
        return readAssociationValue(stdout)
      } catch { return null }
    }
    const status = await inspectDefaultEditors()
    for (const extension of ['.md', '.mdx'] as const) {
      const associated = (await read(extension)) ?? (await classDefault(extension))
      expect(status.associations[extension]).toBe(associated ? 'ready' : 'missing')
    }
  })
})

describe('opening with the default application', () => {
  it('passes the resolved article path once and reports opener failures without changing the file', async () => {
    const file = path.join(project, specialRelative)
    await writeFile(file, source)
    const seen: string[] = []
    const opened = await services.externalEditor.open({ projectPath: project, relativePath: specialRelative }, async (article) => { seen.push(article); return '' }, async () => ready)
    expect(seen).toEqual([opened.articlePath])
    expect(opened.articlePath.endsWith(`${path.sep}a & b!.md`)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(source)
    await writeFile(path.join(project, percentRelative), source)
    const percent: string[] = []
    const percentOpened = await services.externalEditor.open({ projectPath: project, relativePath: percentRelative }, async (article) => { percent.push(article); return '' }, async () => ready)
    expect(percent).toEqual([percentOpened.articlePath])
    let called = false
    await expect(services.externalEditor.open({ projectPath: project, relativePath }, async () => { called = true; return 'No application is associated with the specified file for this operation' }, async () => ready)).rejects.toMatchObject({ code: 'EDITOR_NOT_FOUND' })
    await expect(services.externalEditor.open({ projectPath: project, relativePath }, async () => 'Access is denied.', async () => ready)).rejects.toMatchObject({ code: 'EDITOR_LAUNCH_FAILED' })
    await expect(openWithDefaultApp(opened.articlePath, async () => '')).resolves.toBeUndefined()
    expect(called).toBe(true)
    expect(await readFile(path.join(project, relativePath), 'utf8')).toBe(source)
    const draftRelative = 'src/contents/drafts/草稿.md'
    await mkdir(path.dirname(path.join(project, draftRelative)), { recursive: true })
    await writeFile(path.join(project, draftRelative), source)
    const draftSeen: string[] = []
    const draftOpened = await services.externalEditor.open({ projectPath: project, relativePath: draftRelative }, async (article) => { draftSeen.push(article); return '' }, async () => ready)
    expect(draftSeen).toEqual([draftOpened.articlePath])
    expect(await readFile(path.join(project, draftRelative), 'utf8')).toBe(source)
  })
  it('does not call the opener when no association exists or the path is outside the article', async () => {
    let calls = 0
    const opener = async () => { calls += 1; return '' }
    await expect(services.externalEditor.open({ projectPath: project, relativePath }, opener, async () => missing)).rejects.toMatchObject({ code: 'EDITOR_NOT_FOUND' })
    for (const relative of ['../outside.md', 'package.json', 'src/contents/post/../post/测试.md']) {
      await expect(services.externalEditor.open({ projectPath: project, relativePath: relative }, opener, async () => ready)).rejects.toBeDefined()
    }
    await expect(services.externalEditor.open({ projectPath: root, relativePath }, opener, async () => ready)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
    expect(calls).toBe(0)
    const legacy = JSON.stringify({ version: 1, theme: 'dark', recentProjects: [], lastProjectPath: null, externalEditorPath: { command: 'calc.exe' } })
    const legacyFile = path.join(root, 'legacy.json')
    await writeFile(legacyFile, legacy)
    expect(await createServices(legacyFile).settings.get()).toMatchObject({ theme: 'dark', lastProjectPath: null })
    expect(await readFile(legacyFile, 'utf8')).toBe(legacy)
  })
})
