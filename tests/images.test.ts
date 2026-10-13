import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServices } from '../src/main/services'
import { importArticleImage } from '../src/main/services/images'
import { createContentWatch } from '../src/main/services/content-watch'
import { localImageDestination, resolveMarkdownPath } from '../src/shared/image-path'
import { objectKey, putObject, type ImageStorage } from '../src/main/services/image-storage'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
let temporary: string
let project: string
let services: ReturnType<typeof createServices>

async function fixture(directory: string) {
  await mkdir(path.join(directory, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(directory, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
}

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro-image-test-'))
  project = path.join(temporary, '中文 博客')
  await fixture(project)
  services = createServices(path.join(temporary, 'settings.json'))
  await services.projects.select(project)
})
afterEach(async () => {
  const target = path.resolve(temporary)
  if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-image-test-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
})

describe('article image directories', () => {
  it('keeps a new draft as a file only, and skips a stem already used by a file or a directory', async () => {
    const drafts = path.join(project, 'src/contents/drafts')
    await mkdir(drafts)
    await mkdir(path.join(drafts, '我的 文章'))
    await writeFile(path.join(drafts, '仅文件.mdx'), '---\ntitle: 仅文件\n---\n')
    const directoryTaken = await services.content.createDraft({ projectPath: project, title: '我的 文章', tags: [], category: '', description: '' })
    const fileTaken = await services.content.createDraft({ projectPath: project, title: '仅文件', tags: [], category: '', description: '' })
    expect(directoryTaken.article.relativePath).toBe('src/contents/drafts/我的 文章-2.md')
    expect(fileTaken.article.relativePath).toBe('src/contents/drafts/仅文件-2.md')
    expect(await readdir(path.join(drafts, '我的 文章'))).toEqual([])
    expect(await readdir(drafts)).not.toContain('我的 文章-2')
    const plain = await services.content.createDraft({ projectPath: project, title: '没有图片', tags: [], category: '', description: '' })
    expect(await readdir(drafts)).not.toContain('没有图片')
    expect(plain.article.relativePath).toBe('src/contents/drafts/没有图片.md')
  })

  it('writes the first local image beside the article and encodes the relative link', async () => {
    const created = await services.content.createDraft({ projectPath: project, title: '我的 文章', tags: [], category: '', description: '' })
    const first = await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: '截图 #1.png', alt: '说明 [一]', bytes: png })
    const second = await services.content.importImage({ projectPath: project, relativePath: created.article.relativePath, fileName: '截图 #1.png', alt: '二', bytes: png })
    expect(first).toMatchObject({ storage: 'local' })
    expect(first.markdown).toBe(`![说明 一](${localImageDestination(created.article.relativePath, '截图 #1.png')})`)
    expect(first.markdown).toContain('./%E6%88%91%E7%9A%84%20%E6%96%87%E7%AB%A0/%E6%88%AA%E5%9B%BE%20%231.png')
    expect(second.markdown).toContain('%20%231-2.png')
    const folder = path.join(project, 'src/contents/drafts/我的 文章')
    expect((await readdir(folder)).sort()).toEqual(['截图 #1-2.png', '截图 #1.png'])
    const destination = `./${encodeURIComponent('我的 文章')}/${encodeURIComponent('截图 #1.png')}`
    const preview = await services.content.readPreviewImage({ projectPath: project, relativePath: created.article.relativePath, destination })
    expect(preview?.startsWith('data:image/png;base64,')).toBe(true)
    const saved = await services.content.save({ projectPath: project, relativePath: created.article.relativePath, source: created.source.replace('title: "我的 文章"', 'title: "改了标题"'), baseRevision: created.revision })
    expect(saved.document.article.relativePath).toBe(created.article.relativePath)
    expect(saved.document.article.title).toBe('改了标题')
    expect((await lstat(folder)).isDirectory()).toBe(true)
    expect((await readdir(path.join(project, 'src/contents/drafts'))).filter(name => name.startsWith('改了'))).toEqual([])
  })

  it('reads an older image layout inside the same collection and refuses links that leave it', async () => {
    const relativePath = 'src/contents/post/旧文章.mdx'
    await writeFile(path.join(project, relativePath), '---\ntitle: 旧文章\n---\n')
    await mkdir(path.join(project, 'src/contents/post/images'))
    await writeFile(path.join(project, 'src/contents/post/images/a.png'), png)
    expect(await services.content.readPreviewImage({ projectPath: project, relativePath, destination: './images/a.png' })).toMatch(/^data:image\/png/)
    expect(await services.content.readPreviewImage({ projectPath: project, relativePath, destination: 'https://images.example.com/a.png' })).toBeNull()
    expect(await services.content.readPreviewImage({ projectPath: project, relativePath, destination: '../ai-daily/a.png' })).toBeNull()
    expect(resolveMarkdownPath(relativePath, 'http://example.com/a.png')).toBeNull()
  })

  it('uploads when S3 is enabled and writes nothing locally when upload fails', async () => {
    const created = await services.content.createDraft({ projectPath: project, title: '远程图片', tags: [], category: '', description: '' })
    const storage: ImageStorage = { enabled: true, endpoint: 'https://example.r2.cloudflarestorage.com', region: 'auto', bucket: 'blog-images', publicBaseUrl: 'https://images.example.com', accessKeyId: 'AKIAtestkey', secretAccessKey: 'secret-value-should-not-leak' }
    const current = await services.projects.getCurrent()
    if (!current) throw new Error('项目没有打开。')
    let uploadedPath = ''
    const uploaded = await importArticleImage(current, created.article.relativePath, 'a.png', png, '远端', storage, async (url, init) => {
      const address = String(url)
      const headers = new Headers(init?.headers)
      uploadedPath = new URL(address).pathname
      expect(uploadedPath).toMatch(/^\/blog-images\/astro-desktop\/\d{8}_\d{6}_[a-z0-9]{6}\.png$/)
      expect(headers.get('content-type')).toBe('image/png')
      expect(Buffer.from(init?.body as Uint8Array)).toEqual(png)
      expect(headers.get('if-none-match')).toBe('*')
      expect(address).not.toContain('secret-value-should-not-leak')
      expect(headers.get('authorization')).toContain('AKIAtestkey')
      expect(headers.get('authorization')).toContain('SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date')
      expect(headers.get('authorization')).not.toContain('secret-value-should-not-leak')
      return new Response(null, { status: 200 })
    })
    expect(uploaded.storage).toBe('remote')
    expect(uploaded.markdown).toBe(`![远端](https://images.example.com${uploadedPath.slice('/blog-images'.length)})`)
    expect(await readdir(path.join(project, 'src/contents/drafts'))).toEqual(['远程图片.md'])
    await expect(importArticleImage(current, created.article.relativePath, 'a.png', png, '远端', storage, async () => { throw new Error('secret-value-should-not-leak down') })).rejects.toThrow(/没有保存本地副本/)
    try {
      await importArticleImage(current, created.article.relativePath, 'a.png', png, '远端', storage, async () => { throw new Error('secret-value-should-not-leak down') })
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('secret-value-should-not-leak')
    }
  })

  it('names remote images with local time and random suffixes, preserving image extensions', () => {
    const instant = new Date(2026, 7, 12, 15, 18, 31)
    expect(objectKey('原图.WEBP', instant)).toMatch(/^astro-desktop\/20260812_151831_[a-z0-9]{6}\.webp$/)
    expect(objectKey('原图.jpg', new Date(2026, 0, 2, 3, 4, 5))).toMatch(/^astro-desktop\/20260102_030405_[a-z0-9]{6}\.jpg$/)
    const keys = Array.from({ length: 20 }, () => objectKey('同名.png', instant))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every(key => /^astro-desktop\/20260812_151831_[a-z0-9]{6}\.png$/.test(key))).toBe(true)
  })

  it('reports a remote name collision without returning a link or retrying an overwrite', async () => {
    const storage: ImageStorage = { enabled: true, endpoint: 'https://example.r2.cloudflarestorage.com', region: 'auto', bucket: 'blog-images', publicBaseUrl: 'https://images.example.com', accessKeyId: 'AKIAtestkey', secretAccessKey: 'test-secret' }
    let requests = 0
    await expect(putObject(storage, 'astro-desktop/20260812_151831_8tzhcf.png', png, 'image/png', async (_url, init) => {
      requests++
      expect(new Headers(init?.headers).get('if-none-match')).toBe('*')
      return new Response(null, { status: 412 })
    })).rejects.toMatchObject({ code: 'IMAGE_NAME_CONFLICT' })
    expect(requests).toBe(1)
  })

  it('keeps the secret out of settings and out of the public storage view', async () => {
    await expect(services.imageStorage.update({ enabled: true, endpoint: 'https://example.r2.cloudflarestorage.com', region: 'auto', bucket: 'blog-images', publicBaseUrl: 'https://images.example.com', accessKeyId: 'AKIAtestkey', secretAccessKey: '' })).rejects.toThrow(/凭据/)
    const saved = await services.imageStorage.update({ enabled: true, endpoint: 'https://example.r2.cloudflarestorage.com/', region: 'auto', bucket: 'blog-images', publicBaseUrl: 'https://images.example.com/', accessKeyId: 'AKIAtestkey', secretAccessKey: 'secret-value-should-not-leak' })
    expect(saved).toMatchObject({ enabled: true, endpoint: 'https://example.r2.cloudflarestorage.com', accessKeyHint: '····tkey', secretConfigured: true })
    expect(JSON.stringify(saved)).not.toContain('secret-value')
    const kept = await services.imageStorage.update({ enabled: false, endpoint: saved.endpoint, region: saved.region, bucket: saved.bucket, publicBaseUrl: saved.publicBaseUrl, accessKeyId: '', secretAccessKey: '' })
    expect(kept.secretConfigured).toBe(true)
    expect(kept.enabled).toBe(false)
    const raw = await readFile(path.join(temporary, 'image-storage.json'), 'utf8')
    expect(raw).toContain('secret-value-should-not-leak')
    expect(await readFile(path.join(temporary, 'settings.json'), 'utf8')).not.toContain('secret-value')
    await expect(services.imageStorage.update({ enabled: false, endpoint: 'file://local', region: 'auto', bucket: 'blog-images', publicBaseUrl: '', accessKeyId: '', secretAccessKey: '' })).rejects.toThrow(/endpoint/)
  })

  it('does not import through a directory junction', async () => {
    const outside = path.join(temporary, 'outside')
    await mkdir(path.join(outside, 'stolen'), { recursive: true })
    const drafts = path.join(project, 'src/contents/drafts')
    await mkdir(drafts)
    await symlink(outside, path.join(drafts, '链接文章'), 'junction')
    await writeFile(path.join(drafts, '链接文章.md'), '---\ntitle: 链接文章\n---\n')
    await expect(services.content.importImage({ projectPath: project, relativePath: 'src/contents/drafts/链接文章.md', fileName: 'a.png', alt: '图', bytes: png })).rejects.toThrow(/拒绝写入/)
    expect(await readdir(path.join(outside, 'stolen'))).toEqual([])
  })
})

describe('content watching', () => {
  it('reports a content change once and ignores events while paused', async () => {
    const root = path.join(temporary, 'watch')
    await mkdir(path.join(root, 'src/contents/post'), { recursive: true })
    await mkdir(path.join(root, 'src/contents/drafts'), { recursive: true })
    await mkdir(path.join(root, 'src/contents/ai-daily'), { recursive: true })
    let changes = 0
    const watch = createContentWatch(() => { changes += 1 })
    watch.follow({ path: root } as never)
    await writeFile(path.join(root, 'src/contents/post/新增.md'), 'x')
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(changes).toBeGreaterThan(0)
    const seen = changes
    watch.pause()
    await writeFile(path.join(root, 'src/contents/drafts/暂停.md'), 'x')
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(changes).toBe(seen)
    watch.resume()
    watch.stop()
  })
})
