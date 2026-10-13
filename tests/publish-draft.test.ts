import { compressWebp } from '../src/main/services/image-processing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'
import { publishDraft } from '../src/main/services/publish-draft'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let temporary: string
let project: string
let services: ReturnType<typeof createServices>

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro-publish-test-'))
  project = path.join(temporary, '中文 博客')
  await mkdir(path.join(project, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(project, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  services = createServices(path.join(temporary, 'settings.json'))
  await services.projects.select(project)
})
afterEach(async () => {
  const target = path.resolve(temporary)
  if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-publish-test-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
})

async function draft(title: string) {
  return services.content.createDraft({ projectPath: project, title, tags: [], category: '', description: '' })
}

describe('publish a draft into the post directory', () => {
  it('moves the article and its image directory without rewriting links or remote urls', async () => {
    const created = await draft('我的 文章')
    await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: '图.png', alt: '图', bytes: png })
    const source = `${created.source}\n![图](./%E6%88%91%E7%9A%84%20%E6%96%87%E7%AB%A0/%E5%9B%BE.webp)\n![远程](https://images.example.com/a.webp)\n`
    const saved = await services.content.save({ projectPath: project, relativePath: created.article.relativePath, source, baseRevision: created.revision })
    await services.editor.checkpoint({ projectPath: project, relativePath: created.article.relativePath, source, baseRevision: saved.document.revision })
    const published = await services.content.publishDraft({ projectPath: project, relativePath: created.article.relativePath, baseRevision: saved.document.revision })
    expect(published.imageAction).toBe('moved')
    expect(published.document.article.relativePath).toBe('src/contents/post/我的 文章.md')
    expect(published.document.article.kind).toBe('post')
    const moved = await readFile(path.join(project, 'src/contents/post/我的 文章.md'), 'utf8')
    expect(moved).toBe(source)
    expect(moved).not.toMatch(/^draft:/m)
    expect(await readFile(path.join(project, 'src/contents/post/我的 文章/图.webp'))).toEqual(await compressWebp(png))
    expect(await readdir(path.join(project, 'src/contents/drafts'))).toEqual([])
    const recoveries = await services.editor.listRecoveries()
    expect(recoveries.entries.map(entry => entry.relativePath)).toEqual(['src/contents/post/我的 文章.md'])
    const index = await services.content.list()
    expect(index.articles.map(article => article.relativePath)).toEqual(['src/contents/post/我的 文章.md'])
  })

  it('publishes an article that has no image directory and keeps an mdx file', async () => {
    const created = await draft('没有图片')
    const published = await services.content.publishDraft({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })
    expect(published.imageAction).toBe('none')
    await writeFile(path.join(project, 'src/contents/drafts/组件.mdx'), '---\ntitle: 组件\n---\n正文\n')
    const read = await services.content.read('src/contents/drafts/组件.mdx')
    const mdx = await services.content.publishDraft({ projectPath: project, relativePath: read.article.relativePath, baseRevision: read.revision })
    expect(mdx.document.article.relativePath).toBe('src/contents/post/组件.mdx')
    expect(await readdir(path.join(project, 'src/contents/post'))).toEqual(['没有图片.md', '组件.mdx'])
  })

  it('stops when the target file or image directory already exists', async () => {
    const created = await draft('冲突')
    await writeFile(path.join(project, 'src/contents/post/冲突.md'), '已有正文')
    await expect(services.content.publishDraft({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })).rejects.toThrow(/没有覆盖/)
    expect(await readFile(path.join(project, 'src/contents/post/冲突.md'), 'utf8')).toBe('已有正文')
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    await rm(path.join(project, 'src/contents/post/冲突.md'))
    await mkdir(path.join(project, 'src/contents/post/冲突'))
    await expect(services.content.publishDraft({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })).rejects.toThrow(/没有覆盖/)
    expect(await readdir(path.join(project, 'src/contents/post/冲突'))).toEqual([])
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
  })

  it('copies a shared image directory and leaves the original in place', async () => {
    const created = await draft('共享')
    await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: 'a.png', alt: '图', bytes: png })
    const other = await draft('另一篇')
    const linked = `${other.source}\n![图](./%E5%85%B1%E4%BA%AB/a.webp)\n`
    await services.content.save({ projectPath: project, relativePath: other.article.relativePath, source: linked, baseRevision: other.revision })
    const current = await services.content.read(created.article.relativePath)
    const published = await services.content.publishDraft({ projectPath: project, relativePath: created.article.relativePath, baseRevision: current.revision })
    expect(published.imageAction).toBe('copied')
    expect(await readFile(path.join(project, 'src/contents/post/共享/a.webp'))).toEqual(await compressWebp(png))
    expect(await readFile(path.join(project, 'src/contents/drafts/共享/a.webp'))).toEqual(await compressWebp(png))
    expect(await readFile(path.join(project, 'src/contents/drafts/另一篇.md'), 'utf8')).toBe(linked)
  })

  it('keeps the editor buffer path available when the disk revision changed or the move is interrupted', async () => {
    const created = await draft('中断')
    await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: 'a.png', alt: '图', bytes: png })
    await expect(services.content.publishDraft({ projectPath: project, relativePath: created.article.relativePath, baseRevision: 'a'.repeat(64) })).rejects.toThrow(/没有发布/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    const current = await services.projects.getCurrent()
    if (!current) throw new Error('项目没有打开。')
    await expect(publishDraft(current, { projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision }, async () => undefined, { failAfter: 'article-renamed' })).rejects.toThrow(/正在恢复/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    expect(await readdir(path.join(project, 'src/contents/post'))).toEqual([])
    expect(await readFile(path.join(project, 'src/contents/drafts/中断/a.webp'))).toEqual(await compressWebp(png))
    await expect(publishDraft(current, { projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision }, async () => undefined, { failAfter: 'source-removed' })).rejects.toThrow(/正在恢复/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    expect(await readdir(path.join(project, 'src/contents/post'))).toEqual([])
    expect(await readFile(path.join(project, 'src/contents/drafts/中断/a.webp'))).toEqual(await compressWebp(png))
  })
})
