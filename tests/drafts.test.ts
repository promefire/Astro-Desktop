import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { parse } from 'yaml'
import { createServices } from '../src/main/services'
import type { CreateDraftInput } from '../src/shared/contracts'

let temporary: string
let project: string
let services: ReturnType<typeof createServices>
const fields = { title: '我的 Astro 文章', tags: ['Astro', '中文 标签'], category: '写作', description: '第一行\n第二行：摘要' }
const input = (changes: Partial<CreateDraftInput> = {}) => ({ projectPath: project, ...fields, ...changes })
async function fixture(directory: string) {
  await mkdir(path.join(directory, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(directory, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
}

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro-draft-test-'))
  project = path.join(temporary, '中文 博客')
  await fixture(project)
  services = createServices(path.join(temporary, 'settings.json'))
})
afterEach(async () => {
  const target = path.resolve(temporary)
  if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-draft-test-')) await rm(target, { recursive: true, force: true })
})

describe('ordinary draft creation on real files', () => {
  it('creates a draft that reopens after restart and parses as Astro YAML dates and typed metadata', async () => {
    await services.projects.select(project)
    const result = await services.content.createDraft(input({ title: ' on ', tags: ['Astro', 'Astro', ' on ', '2026-10-10'], category: 'true' }))
    expect(result.article).toMatchObject({ title: 'on', draft: true, category: 'true', tags: ['Astro', 'on', '2026-10-10'], description: fields.description, kind: 'post', extension: '.md', issues: [] })
    const source = await readFile(path.join(project, result.article.relativePath), 'utf8')
    expect(source).toBe(result.source)
    const yaml = parse(source.split('---\n')[1], { schema: 'yaml-1.1' })
    expect(yaml.published).toBeInstanceOf(Date)
    expect(yaml).toMatchObject({ title: 'on', category: 'true', tags: ['Astro', 'on', '2026-10-10'], draft: true, description: fields.description })
    expect(result.article.published).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(result.body).toBe('\n')
    const restarted = createServices(path.join(temporary, 'settings.json'))
    await restarted.projects.openRecent(project)
    expect((await restarted.content.read(result.article.relativePath)).source).toBe(source)
    expect((await restarted.content.list()).articles).toHaveLength(1)
    expect(await readdir(path.join(project, 'src/contents/post'))).toEqual(['on.md'])
    expect(await readdir(path.join(project, 'src/contents/ai-daily'))).toEqual([])
  })

  it('does not overwrite occupied names, even across concurrent service instances', async () => {
    const other = createServices(path.join(temporary, 'other-settings.json'))
    await services.projects.select(project)
    await other.projects.select(project)
    const existing = path.join(project, 'src/contents/post/重复.md')
    await writeFile(existing, 'existing contents must stay exact')
    // A directory collision is also occupied, never replaced or recursively removed.
    await mkdir(path.join(project, 'src/contents/post/重复-2.md'))
    const results = await Promise.all([services.content.createDraft(input({ title: '重复' })), other.content.createDraft(input({ title: '重复' }))])
    expect(results.map(result => result.article.relativePath).sort()).toEqual(['src/contents/post/重复-3.md', 'src/contents/post/重复-4.md'])
    expect(await readFile(existing, 'utf8')).toBe('existing contents must stay exact')
    expect(await readdir(path.join(project, 'src/contents/post'))).toHaveLength(4)
  })

  it('normalizes Windows filenames while preserving the authored title and escaping YAML injection', async () => {
    await services.projects.select(project)
    for (const title of ['../目录\\文件: *? "<>|', 'CON', 'nul.txt', 'ＣＯＭ¹', ' . ', '文'.repeat(200), '标题: "on" # !<tag>']) {
      const result = await services.content.createDraft(input({ title }))
      expect(result.article.title).toBe(title.trim())
      const filename = path.basename(result.article.relativePath)
      expect(filename).not.toMatch(/[<>:"/\\|?*]/)
      expect(filename).not.toMatch(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i)
      expect(result.article.relativePath.split('/')).toHaveLength(4)
      expect(result.article.issues).toEqual([])
    }
  })

  it('rejects empty, malformed, oversized and unexpected fields without creating files', async () => {
    await services.projects.select(project)
    const invalid = [null, [], input({ title: '  ' }), input({ title: 'x'.repeat(201) }), input({ title: 'bad\nnew line' }), input({ description: '\0' }), input({ description: 'x'.repeat(2001) }), input({ tags: Array(33).fill('tag') }), input({ tags: [''] }), { ...input(), tags: 'one' }, { ...input(), category: ['a'] }, { ...input(), title: 23 }, { ...input(), kind: 'ai-daily' }, { ...input(), relativePath: '../escape.md' }, { ...input(), source: 'arbitrary code' }]
    for (const value of invalid) await expect(services.content.createDraft(value)).rejects.toMatchObject({ code: 'INVALID_DRAFT' })
    expect(await readdir(path.join(project, 'src/contents/post'))).toEqual([])
  })

  it('requires an active project and rejects a request queued for a previous project', async () => {
    await expect(services.content.createDraft(input())).rejects.toMatchObject({ code: 'NO_PROJECT' })
    await services.projects.select(project)
    const second = path.join(temporary, 'second')
    await fixture(second)
    const switching = services.projects.select(second)
    const stale = services.content.createDraft(input())
    await switching
    await expect(stale).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
    expect(await readdir(path.join(second, 'src/contents/post'))).toEqual([])
    expect(await readdir(path.join(project, 'src/contents/post'))).toEqual([])
  })

  it('rejects replaced or linked collection directories, including links into the AI daily collection', async () => {
    await services.projects.select(project)
    const collection = path.join(project, 'src/contents/post')
    await rename(collection, `${collection}-original`)
    await expect(services.content.createDraft(input())).rejects.toMatchObject({ code: 'CREATE_FAILED' })
    await symlink(path.join(project, 'src/contents/ai-daily'), collection, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(services.content.createDraft(input())).rejects.toMatchObject({ code: 'UNSAFE_WRITE_PATH' })
    expect(await readdir(path.join(project, 'src/contents/ai-daily'))).toEqual([])
  })
})
