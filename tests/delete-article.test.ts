import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'

let temporary: string
let project: string
let services: ReturnType<typeof createServices>

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro-delete-test-'))
  project = path.join(temporary, '中文 博客')
  await mkdir(path.join(project, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(project, 'src/contents/drafts'), { recursive: true })
  await mkdir(path.join(project, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  services = createServices(path.join(temporary, 'settings.json'))
  await services.projects.select(project)
})
afterEach(async () => {
  const target = path.resolve(temporary)
  if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-delete-test-')) await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const article = (title: string) => `---\ntitle: ${title}\npublished: 2026-01-01\n---\n正文\n`

describe('delete article files', () => {
  it('removes only the chosen file and its recovery record', async () => {
    const draft = 'src/contents/drafts/草稿.md'
    const post = 'src/contents/post/正文.md'
    const daily = 'src/contents/ai-daily/日报.md'
    await writeFile(path.join(project, draft), article('草稿'))
    await writeFile(path.join(project, post), article('正文'))
    await writeFile(path.join(project, daily), '---\ntitle: 日报\npublished: 2026-01-01\nsummary: 摘要\n---\n正文\n')
    const document = await services.content.read(draft)
    await services.editor.checkpoint({ projectPath: project, relativePath: draft, source: `${document.source}未保存\n`, baseRevision: document.revision })
    await services.content.deleteArticle({ projectPath: project, relativePath: draft })
    await expect(readFile(path.join(project, draft), 'utf8')).rejects.toThrow()
    expect(await services.editor.getRecovery({ projectPath: project, relativePath: draft })).toBeNull()
    expect((await services.content.list()).articles.map(item => item.relativePath).sort()).toEqual([daily, post])
    expect(await readFile(path.join(project, post), 'utf8')).toContain('正文')
  })

  it('refuses links, directories, traversal, and a switched project', async () => {
    const kept = path.join(project, 'src/contents/post/保留.md')
    const linked = path.join(project, 'src/contents/post/链接.md')
    await writeFile(kept, article('保留'))
    await link(kept, linked)
    await expect(services.content.deleteArticle({ projectPath: project, relativePath: 'src/contents/post/链接.md' })).rejects.toMatchObject({ code: 'UNSAFE_DELETE_PATH' })
    expect(await readFile(kept, 'utf8')).toContain('保留')
    expect(await readFile(linked, 'utf8')).toContain('保留')
    const blocked = path.join(project, 'src/contents/drafts/不是文件.md')
    await mkdir(blocked)
    await expect(services.content.deleteArticle({ projectPath: project, relativePath: 'src/contents/drafts/不是文件.md' })).rejects.toMatchObject({ code: 'UNSAFE_DELETE_PATH' })
    await expect(services.content.deleteArticle({ projectPath: project, relativePath: '../package.json' })).rejects.toThrow()
    await expect(services.content.deleteArticle({ projectPath: project, relativePath: 'package.json', extra: true })).rejects.toMatchObject({ code: 'INVALID_DELETE' })
    const other = path.join(temporary, '另一个')
    await mkdir(path.join(other, 'src/contents/post'), { recursive: true })
    await mkdir(path.join(other, 'src/contents/ai-daily'), { recursive: true })
    await writeFile(path.join(other, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
    await services.projects.select(other)
    await expect(services.content.deleteArticle({ projectPath: project, relativePath: 'src/contents/post/保留.md' })).rejects.toMatchObject({ code: 'PROJECT_CHANGED' })
    expect(await readFile(kept, 'utf8')).toContain('保留')
    const outside = path.join(temporary, '项目外')
    await mkdir(outside)
    await writeFile(path.join(outside, '逃出.md'), article('逃出'))
    await symlink(outside, path.join(project, 'src/contents/post/外链'), process.platform === 'win32' ? 'junction' : 'dir')
    await services.projects.select(project)
    await expect(services.content.deleteArticle({ projectPath: project, relativePath: 'src/contents/post/外链/逃出.md' })).rejects.toMatchObject({ code: 'UNSAFE_DELETE_PATH' })
    expect(await readFile(path.join(outside, '逃出.md'), 'utf8')).toContain('逃出')
  })
})
