import { compressWebp } from '../src/main/services/image-processing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'
import { withdrawPost } from '../src/main/services/withdraw-post'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let temporary: string
let project: string
let services: ReturnType<typeof createServices>

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro-withdraw-test-'))
  project = path.join(temporary, '中文 博客')
  await mkdir(path.join(project, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(project, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  services = createServices(path.join(temporary, 'settings.json'))
  await services.projects.select(project)
})
afterEach(async () => {
  const target = path.resolve(temporary)
  if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-withdraw-test-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
})

const source = (title: string, body = '正文内容') => `---\ntitle: ${title}\npublished: 2026-02-03 04:05:06\ncategory: 后端\ntags: [Astro]\n---\n\n${body}\n`

async function write(relative: string, text: string) {
  await writeFile(path.join(project, ...relative.split('/')), text)
  return services.content.read(relative)
}

async function entries(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).sort() } catch { return [] }
}

describe('withdraw a post back into the draft directory', () => {
  it('moves the article and its image directory without rewriting links or remote urls', async () => {
    const created = await write('src/contents/post/我的 正文.md', source('我的正文'))
    await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: '图.png', alt: '图', bytes: png })
    const text = `${created.source}\n![图](./%E6%88%91%E7%9A%84%20%E6%AD%A3%E6%96%87/%E5%9B%BE.webp)\n![远程](https://images.example.com/a.webp)\n`
    const saved = await services.content.save({ projectPath: project, relativePath: created.article.relativePath, source: text, baseRevision: created.revision })
    await services.editor.checkpoint({ projectPath: project, relativePath: created.article.relativePath, source: text, baseRevision: saved.document.revision })
    const withdrawn = await services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: saved.document.revision })
    expect(withdrawn.imageAction).toBe('moved')
    expect(withdrawn.document.article.relativePath).toBe('src/contents/drafts/我的 正文.md')
    expect(withdrawn.document.article.kind).toBe('draft')
    expect(withdrawn.message).toContain('没有提交或部署')
    const moved = await readFile(path.join(project, 'src/contents/drafts/我的 正文.md'), 'utf8')
    expect(moved).toBe(text)
    expect(moved).not.toMatch(/^draft:/m)
    expect(await readFile(path.join(project, 'src/contents/drafts/我的 正文/图.webp'))).toEqual(await compressWebp(png))
    expect(await entries(path.join(project, 'src/contents/post'))).toEqual([])
    const recoveries = await services.editor.listRecoveries()
    expect(recoveries.entries.map(entry => entry.relativePath)).toEqual(['src/contents/drafts/我的 正文.md'])
    const index = await services.content.list()
    expect(index.articles.map(article => article.relativePath)).toEqual(['src/contents/drafts/我的 正文.md'])
    expect(index.articles[0]?.kind).toBe('draft')
  })

  it('creates the drafts directory and keeps an mdx file', async () => {
    expect(await entries(path.join(project, 'src/contents/drafts'))).toEqual([])
    await write('src/contents/post/没有图片.md', source('没有图片'))
    const plain = (await services.content.list()).articles.find(article => article.relativePath.endsWith('没有图片.md'))
    if (!plain) throw new Error('没有读到正文。')
    const read = await services.content.read(plain.relativePath)
    const none = await services.content.withdrawPost({ projectPath: project, relativePath: read.article.relativePath, baseRevision: read.revision })
    expect(none.imageAction).toBe('none')
    expect(none.document.article.relativePath).toBe('src/contents/drafts/没有图片.md')
    const mdx = await write('src/contents/post/组件.mdx', source('组件'))
    const component = await services.content.withdrawPost({ projectPath: project, relativePath: mdx.article.relativePath, baseRevision: mdx.revision })
    expect(component.document.article.relativePath).toBe('src/contents/drafts/组件.mdx')
    expect(component.document.article.extension).toBe('.mdx')
    expect(await entries(path.join(project, 'src/contents/drafts'))).toEqual(['没有图片.md', '组件.mdx'])
  })

  it('keeps the directory shape when the post sits in a subdirectory', async () => {
    await mkdir(path.join(project, 'src/contents/post/子目录'), { recursive: true })
    const created = await write('src/contents/post/子目录/嵌套.md', source('嵌套'))
    const withdrawn = await services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })
    expect(withdrawn.document.article.relativePath).toBe('src/contents/drafts/子目录/嵌套.md')
    expect(await readFile(path.join(project, 'src/contents/drafts/子目录/嵌套.md'), 'utf8')).toBe(created.source)
  })

  it('stops when the draft directory already holds the article, the image directory or the other extension', async () => {
    const created = await write('src/contents/post/冲突.md', source('冲突'))
    await mkdir(path.join(project, 'src/contents/drafts'), { recursive: true })
    await writeFile(path.join(project, 'src/contents/drafts/冲突.md'), '已有草稿')
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })).rejects.toThrow(/没有覆盖/)
    expect(await readFile(path.join(project, 'src/contents/drafts/冲突.md'), 'utf8')).toBe('已有草稿')
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    await rm(path.join(project, 'src/contents/drafts/冲突.md'))
    await mkdir(path.join(project, 'src/contents/drafts/冲突'))
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })).rejects.toThrow(/没有覆盖/)
    expect(await entries(path.join(project, 'src/contents/drafts/冲突'))).toEqual([])
    await rm(path.join(project, 'src/contents/drafts/冲突'), { recursive: true })
    await writeFile(path.join(project, 'src/contents/drafts/冲突.mdx'), '已有组件')
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision })).rejects.toThrow(/没有覆盖/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
  })

  it('copies a shared image directory and leaves the original in place', async () => {
    const created = await write('src/contents/post/共享.md', source('共享'))
    await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: 'a.png', alt: '图', bytes: png })
    const linked = `${source('引用')}\n![图](./%E5%85%B1%E4%BA%AB/a.webp)\n`
    await write('src/contents/post/引用.md', linked)
    const current = await services.content.read(created.article.relativePath)
    const withdrawn = await services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: current.revision })
    expect(withdrawn.imageAction).toBe('copied')
    expect(await readFile(path.join(project, 'src/contents/drafts/共享/a.webp'))).toEqual(await compressWebp(png))
    expect(await readFile(path.join(project, 'src/contents/post/共享/a.webp'))).toEqual(await compressWebp(png))
    expect(await readFile(path.join(project, 'src/contents/post/引用.md'), 'utf8')).toBe(linked)
  })

  it('keeps the article in place when the disk revision changed or the move is interrupted', async () => {
    const created = await write('src/contents/post/中断.md', source('中断'))
    await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: 'a.png', alt: '图', bytes: png })
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: 'a'.repeat(64) })).rejects.toThrow(/没有撤回/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    const current = await services.projects.getCurrent()
    if (!current) throw new Error('项目没有打开。')
    await expect(withdrawPost(current, { projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision }, async () => undefined, { failAfter: 'article-renamed' })).rejects.toThrow(/正在恢复/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    expect(await entries(path.join(project, 'src/contents/drafts'))).toEqual([])
    expect(await readFile(path.join(project, 'src/contents/post/中断/a.webp'))).toEqual(await compressWebp(png))
    await expect(withdrawPost(current, { projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision }, async () => undefined, { failAfter: 'source-removed' })).rejects.toThrow(/正在恢复/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    expect(await entries(path.join(project, 'src/contents/drafts'))).toEqual([])
    expect(await readFile(path.join(project, 'src/contents/post/中断/a.webp'))).toEqual(await compressWebp(png))
  })

  it('rejects ai daily articles, draft paths, unknown fields and another project', async () => {
    await writeFile(path.join(project, 'src/contents/ai-daily/2026-02-03.md'), '---\ntitle: 日报\npublished: 2026-02-03\nsummary: 摘要\n---\n\n日报内容\n')
    const daily = await services.content.read('src/contents/ai-daily/2026-02-03.md')
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: daily.article.relativePath, baseRevision: daily.revision })).rejects.toThrow(/只有 src\/contents\/post/)
    const created = await write('src/contents/post/类型.md', source('类型'))
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: created.revision, extra: true })).rejects.toThrow(/只接受当前正文/)
    await expect(services.content.withdrawPost({ projectPath: path.join(temporary, '别的博客'), relativePath: created.article.relativePath, baseRevision: created.revision })).rejects.toThrow(/当前项目已切换/)
    await expect(services.content.withdrawPost({ projectPath: project, relativePath: created.article.relativePath, baseRevision: 'abc' })).rejects.toThrow(/撤回参数无效/)
    expect(await readFile(path.join(project, created.article.relativePath), 'utf8')).toBe(created.source)
    expect(await entries(path.join(project, 'src/contents/drafts'))).toEqual([])
  })
})
