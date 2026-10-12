import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'
import { exportInput, writeEditorCopy } from '../src/main/services/export-copy'

let root: string, project: string, file: string, services: ReturnType<typeof createServices>
const relativePath = 'src/contents/post/测试.mdx'
const source = '\uFEFF---\r\n# 保留注释\r\ntitle: "原文章"\r\npublished: 2026-01-01\r\ndraft: true\r\ncustom: {unknown: yes}\r\n---\r\nimport Demo from "./Demo.astro"\n\n<Demo />\r\n正文\n'
async function fixture(directory: string) {
  await mkdir(path.join(directory, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(directory, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
}
const target = () => ({ projectPath: project, relativePath })
const input = async (next = source + '新增正文\r\n') => ({ ...target(), source: next, baseRevision: (await services.content.read(relativePath)).revision })
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'astro-editor-test-'))
  project = path.join(root, '中文 博客'); file = path.join(project, relativePath)
  await fixture(project); await writeFile(file, source)
  services = createServices(path.join(root, 'settings.json')); await services.projects.select(project)
})
afterEach(async () => {
  if (path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith('astro-editor-test-')) await rm(root, { recursive: true, force: true })
})
describe('real editor storage', () => {
  it('saves exact BOM, mixed line endings, comments, unknown fields and MDX; backs up outside the blog', async () => {
    const request = await input(source.replace('原文章', '保存标题'))
    const saved = await services.content.save(request)
    expect(await readFile(file, 'utf8')).toBe(request.source)
    expect(saved.document.article.title).toBe('保存标题')
    expect(saved.document.revision).not.toBe(request.baseRevision)
    expect(saved.document.frontmatter.custom).toEqual({ unknown: 'yes' })
    expect(await services.editor.getRecovery(target())).toBeNull()
    const backups = await readdir(path.join(root, 'editor/backups'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(await readFile(path.join(root, 'editor/backups', backups[0]), 'utf8')).source).toBe(source)
    expect(await readdir(path.dirname(file))).toEqual(['测试.mdx'])
  })
  it('rejects external changes and serializes competing saves without losing either buffer', async () => {
    const request = await input()
    const results = await Promise.allSettled([services.content.save(request), services.content.save({ ...request, source: source + 'second' })])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'REVISION_CONFLICT' } })
    expect(await readFile(file, 'utf8')).toBe(request.source)
    expect((await services.editor.getRecovery(target()))?.source).toBe(source + 'second')
    await writeFile(file, source + 'external')
    await expect(services.content.save(request)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await readFile(file, 'utf8')).toBe(source + 'external')
  })
  it('preserves invalid input in recovery without overwriting the original', async () => {
    for (const next of [source.replace('title: "原文章"', 'title: []'), source.replace('draft: true', 'draft: wrong'), source.replace('custom: {unknown: yes}', 'custom: [')]) {
      await expect(services.content.save(await input(next))).rejects.toBeDefined()
      expect(await readFile(file, 'utf8')).toBe(source)
      expect((await services.editor.getRecovery(target()))?.source).toBe(next)
    }
  })
  it('recovers after restart and after original deletion; isolates projects', async () => {
    const request = await input(); await services.editor.checkpoint(request); await unlink(file)
    await expect(services.content.save(request)).rejects.toMatchObject({ code: 'FILE_MISSING' })
    const restarted = createServices(path.join(root, 'settings.json')); await restarted.projects.openRecent(project)
    expect(await restarted.editor.getRecovery(target())).toMatchObject(request)
    expect((await restarted.editor.listRecoveries()).entries).toHaveLength(1)
    const other = path.join(root, 'other'); await fixture(other); await restarted.projects.select(other)
    expect((await restarted.editor.listRecoveries()).entries).toEqual([])
    await expect(restarted.editor.checkpoint(request)).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
    await restarted.projects.openRecent(project); await restarted.editor.clearRecovery(target())
    expect(await restarted.editor.getRecovery(target())).toBeNull()
  })
  it('rejects traversal, wrong projects, oversized buffers and malformed revisions', async () => {
    const request = await input()
    for (const bad of [null, { ...request, relativePath: '../outside.md' }, { ...request, relativePath: 'package.json' }, { ...request, projectPath: root }, { ...request, source: 'a'.repeat(4 * 1024 * 1024 + 1) }, { ...request, source: 'bad\0' }, { ...request, baseRevision: 'fake' }]) await expect(services.content.save(bad)).rejects.toBeDefined()
    expect(await readFile(file, 'utf8')).toBe(source)
    expect((await services.editor.listRecoveries()).entries).toEqual([])
  })
  it('refuses hardlinks and junctions before replacing a file', async () => {
    const request = await input()
    const alias = path.join(root, 'alias.mdx'); await link(file, alias)
    await expect(services.content.save(request)).rejects.toMatchObject({ code: 'UNSAFE_WRITE_PATH' })
    await unlink(alias)
    const collection = path.dirname(file); await rename(collection, collection + '-held')
    await symlink(collection + '-held', collection, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(services.content.save(request)).rejects.toMatchObject({ code: 'UNSAFE_WRITE_PATH' })
    expect(await readFile(file, 'utf8')).toBe(source)
  })
  it('does not replace the original when backup storage fails and cleans its temporary file', async () => {
    await mkdir(path.join(root, 'editor'), { recursive: true }); await writeFile(path.join(root, 'editor/backups'), 'occupied')
    await expect(services.content.save(await input())).rejects.toMatchObject({ code: 'SAVE_FAILED' })
    expect(await readFile(file, 'utf8')).toBe(source)
    expect(await readdir(path.dirname(file))).toEqual(['测试.mdx'])
    expect(await services.editor.getRecovery(target())).not.toBeNull()
  })
  it('reports corrupt recovery records and keeps their bytes', async () => {
    await services.editor.checkpoint(await input())
    const directory = path.join(root, 'editor/recovery'), record = path.join(directory, (await readdir(directory))[0])
    await writeFile(record, '{broken')
    await expect(services.editor.getRecovery(target())).rejects.toMatchObject({ code: 'RECOVERY_CORRUPT' })
    expect((await services.editor.listRecoveries()).issues).toHaveLength(1)
    await expect(services.editor.checkpoint(await input())).rejects.toMatchObject({ code: 'RECOVERY_CORRUPT' })
    expect(await readFile(record, 'utf8')).toBe('{broken')
  })
  it('exports exact buffers without overwriting existing files or leaving temporary files', async () => {
    const destination = path.join(root, '恢复副本.mdx')
    await writeEditorCopy(destination, source)
    await expect(writeEditorCopy(destination, 'replacement')).rejects.toMatchObject({ code: 'COPY_EXISTS' })
    expect(await readFile(destination, 'utf8')).toBe(source)
    expect((await readdir(root)).filter(file => file.endsWith('.tmp'))).toEqual([])
    expect(exportInput({ source, suggestedName: '../恢复:副本.mdx' }).suggestedName).toBe('恢复-副本.mdx')
    expect(() => exportInput({ source: '\0' })).toThrow()
  })
})
