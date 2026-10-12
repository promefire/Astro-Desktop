import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'
import { externalEditorInvocation } from '../src/main/services/external-editor'

let root: string, project: string, services: ReturnType<typeof createServices>
const relativePath = 'src/contents/post/测试.md'
const specialRelative = 'src/contents/post/a & b!.md'
const source = '---\r\ntitle: "外部编辑"\r\npublished: 2026-01-01\r\ndraft: true\r\n---\r\n正文\r\n'
const csc = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')

async function fixture(directory: string) {
  await mkdir(path.join(directory, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(directory, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
}
function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited ${code}: ${stderr}`)))
  })
}
async function compileEditor(directory: string): Promise<string> {
  const sourceFile = path.join(directory, 'EditorStub.cs')
  const executable = path.join(directory, 'Astro Editor.exe')
  await writeFile(sourceFile, 'using System.IO; using System.Text; class EditorStub { static void Main(string[] args) { var dir = Path.GetDirectoryName(typeof(EditorStub).Assembly.Location); File.WriteAllText(Path.Combine(dir, "marker.txt"), args.Length == 1 ? args[0] : "count:" + args.Length, new UTF8Encoding(false)); } }')
  await run(csc, ['/nologo', `/out:${executable}`, sourceFile])
  return executable
}
const editorScript = '@echo off\r\necho RAN>"%~dp0executed.txt"\r\ncopy /y "%~1" "%~dp0opened-copy.md" >nul\r\nif errorlevel 1 exit /b 2\r\n>> "%~1" echo EXTERNAL_EDIT\r\nexit /b 0\r\n'
async function exists(file: string): Promise<boolean> { try { await access(file); return true } catch { return false } }

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

describe('external editor command shape', () => {
  const article = 'D:\\中文 博客\\a & b!.md'
  const script = 'D:\\外部 编辑器\\打开 文章.cmd'
  const executable = 'D:\\外部 编辑器\\Astro Editor.exe'
  it('passes exe and cmd paths as arguments without a shell string', () => {
    const exe = externalEditorInvocation(executable, article)
    expect(exe).toMatchObject({ file: executable, args: [article], options: { shell: false, windowsVerbatimArguments: false } })
    const cmd = externalEditorInvocation(script, article)
    expect(cmd.options).toMatchObject({ shell: false, windowsVerbatimArguments: true })
    expect(cmd.file.toLowerCase().endsWith('\\system32\\cmd.exe')).toBe(true)
    expect(cmd.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c'])
    expect(cmd.args).toHaveLength(5)
    expect(cmd.args[4]).toContain(`"${script}"`)
    expect(cmd.args[4]).toContain(`"${article}"`)
    expect(cmd.args[4]?.includes(`${script} ${article}`)).toBe(false)
  })
  it('rejects command interpreters and percent signs in cmd launches', () => {
    expect(() => externalEditorInvocation('C:\\Windows\\System32\\cmd.exe', article)).toThrow(expect.objectContaining({ code: 'EDITOR_INVALID' }))
    expect(() => externalEditorInvocation(script, 'D:\\中文\\100% ok.md')).toThrow(expect.objectContaining({ code: 'EDITOR_UNSAFE_PATH' }))
    expect(externalEditorInvocation(executable, 'D:\\中文\\100% ok.md').args).toEqual(['D:\\中文\\100% ok.md'])
    expect(() => externalEditorInvocation('code.cmd', article)).toThrow(expect.objectContaining({ code: 'EDITOR_INVALID' }))
  })
})

describe('real external editor', () => {
  it('opens an exe with one exact Chinese, spaced and ampersand path', async () => {
    const editorDir = path.join(root, '外部 编辑器')
    await mkdir(editorDir, { recursive: true })
    const executable = await compileEditor(editorDir)
    const file = path.join(project, specialRelative)
    await writeFile(file, source)
    await services.settings.setExternalEditor(executable)
    expect((await services.settings.checkExternalEditor()).state).toBe('ready')
    const opened = await services.externalEditor.open({ projectPath: project, relativePath: specialRelative })
    expect(await readFile(path.join(editorDir, 'marker.txt'), 'utf8')).toBe(opened.articlePath)
    expect(opened.articlePath.endsWith(`${path.sep}a & b!.md`)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(source)
  })
  it('opens a cmd without executing it during checks, then keeps external edits on conflict', async () => {
    const editorDir = path.join(root, '外部 编辑器')
    const script = path.join(editorDir, '打开 文章.cmd')
    const file = path.join(project, specialRelative)
    await mkdir(editorDir, { recursive: true })
    await writeFile(script, editorScript)
    await writeFile(file, source)
    await services.settings.setExternalEditor(script)
    expect(await services.settings.checkExternalEditor()).toMatchObject({ state: 'ready' })
    expect(await exists(path.join(editorDir, 'executed.txt'))).toBe(false)
    const before = await readFile(file)
    const revision = (await services.content.read(specialRelative)).revision
    const opened = await services.externalEditor.open({ projectPath: project, relativePath: specialRelative })
    expect(opened.articlePath.endsWith(`${path.sep}a & b!.md`)).toBe(true)
    expect(await readFile(path.join(editorDir, 'opened-copy.md'))).toEqual(before)
    const after = await readFile(file)
    expect(after.equals(Buffer.concat([before, Buffer.from('EXTERNAL_EDIT\r\n')]))).toBe(true)
    await expect(services.content.save({ projectPath: project, relativePath: specialRelative, source: source + 'MORE', baseRevision: revision })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await readFile(file)).toEqual(after)
  })
  it('reports missing, invalid, unconfigured and launch failure without pretending success', async () => {
    const target = { projectPath: project, relativePath }
    await expect(services.externalEditor.open(target)).rejects.toMatchObject({ code: 'EDITOR_NOT_CONFIGURED' })
    const editorDir = path.join(root, '外部 编辑器')
    await mkdir(editorDir, { recursive: true })
    const removed = path.join(editorDir, 'missing editor.cmd')
    await writeFile(removed, '@echo off\r\nexit /b 0\r\n')
    await services.settings.setExternalEditor(removed)
    await rm(removed)
    expect(await services.settings.checkExternalEditor()).toMatchObject({ state: 'missing' })
    await expect(services.externalEditor.open(target)).rejects.toMatchObject({ code: 'EDITOR_NOT_FOUND' })
    const failing = path.join(editorDir, '失败.cmd')
    await writeFile(failing, '@echo off\r\nexit /b 5\r\n')
    await services.settings.setExternalEditor(failing)
    await expect(services.externalEditor.open(target)).rejects.toMatchObject({ code: 'EDITOR_LAUNCH_FAILED' })
    expect(await readFile(path.join(project, relativePath), 'utf8')).toBe(source)
    for (const candidate of ['code.cmd', path.join(editorDir, 'notes.txt'), editorDir, 'C:\\Windows\\System32\\cmd.exe', 'C:\\Windows\\System32\\cmd.exe /c calc.exe']) {
      await expect(services.settings.setExternalEditor(candidate)).rejects.toBeDefined()
    }
    expect((await services.settings.get()).externalEditorPath?.endsWith('失败.cmd')).toBe(true)
    const fake = path.join(editorDir, 'fake.exe')
    await mkdir(fake)
    await expect(services.settings.setExternalEditor(fake)).rejects.toMatchObject({ code: 'EDITOR_INVALID' })
    await services.settings.setExternalEditor(null)
    expect(await services.settings.checkExternalEditor()).toMatchObject({ state: 'unconfigured', path: null })
  })
  it('refuses percent paths for cmd scripts and still opens them with an exe', async () => {
    const editorDir = path.join(root, '外部 编辑器')
    const percentRelative = 'src/contents/post/100% ok.md'
    await mkdir(editorDir, { recursive: true })
    await writeFile(path.join(editorDir, '打开 文章.cmd'), editorScript)
    await writeFile(path.join(project, percentRelative), source)
    await services.settings.setExternalEditor(path.join(editorDir, '打开 文章.cmd'))
    await expect(services.externalEditor.open({ projectPath: project, relativePath: percentRelative })).rejects.toMatchObject({ code: 'EDITOR_UNSAFE_PATH' })
    expect(await exists(path.join(editorDir, 'executed.txt'))).toBe(false)
    const executable = await compileEditor(editorDir)
    await services.settings.setExternalEditor(executable)
    const opened = await services.externalEditor.open({ projectPath: project, relativePath: percentRelative })
    expect(await readFile(path.join(editorDir, 'marker.txt'), 'utf8')).toBe(opened.articlePath)
    expect(await readFile(path.join(project, percentRelative), 'utf8')).toBe(source)
  })
  it('does not launch for outside paths or a switched project, and preserves old settings', async () => {
    const editorDir = path.join(root, '外部 编辑器')
    const script = path.join(editorDir, '打开 文章.cmd')
    await mkdir(editorDir, { recursive: true })
    await writeFile(script, editorScript)
    await services.settings.setExternalEditor(script)
    for (const relativePath of ['../outside.md', 'package.json', 'src/contents/post/../post/测试.md']) {
      await expect(services.externalEditor.open({ projectPath: project, relativePath })).rejects.toBeDefined()
    }
    await expect(services.externalEditor.open({ projectPath: root, relativePath })).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
    expect(await exists(path.join(editorDir, 'executed.txt'))).toBe(false)
    const legacyFile = path.join(root, 'legacy.json')
    const legacy = JSON.stringify({ version: 1, theme: 'dark', recentProjects: [], lastProjectPath: null })
    await writeFile(legacyFile, legacy)
    const legacyServices = createServices(legacyFile)
    expect((await legacyServices.settings.get()).externalEditorPath).toBeNull()
    const brokenFile = path.join(root, 'broken.json')
    const broken = JSON.stringify({ version: 1, theme: 'system', recentProjects: [], lastProjectPath: null, externalEditorPath: { command: 'calc.exe' } })
    await writeFile(brokenFile, broken)
    await expect(createServices(brokenFile).settings.get()).rejects.toMatchObject({ code: 'SETTINGS_CORRUPT' })
    expect(await readFile(brokenFile, 'utf8')).toBe(broken)
    const restarted = createServices(path.join(root, 'settings.json'))
    expect((await restarted.settings.get()).externalEditorPath).toBe((await services.settings.get()).externalEditorPath)
  })
})
