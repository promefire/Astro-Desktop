import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const article = (title: string, extra: string) => `---\ntitle: ${title}\npublished: 2026-02-03 04:05:06\n${extra}---\n\n正文内容。\n`

test('writes only tags under an article title and keeps the daily type label', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-list-detail-e2e-'))
  const blog = path.join(root, '中文 博客')
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/drafts'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, 'src/contents/post/带标签.md'), article('带标签的正文', 'category: 后端\ntags: [Java, Spring Boot]\n'))
  await writeFile(path.join(blog, 'src/contents/post/无标签.md'), article('没有标签的正文', 'category: 后端\ntags: []\n'))
  await writeFile(path.join(blog, 'src/contents/drafts/草稿带标签.md'), article('带标签的草稿', 'category: 前端\ntags: [Astro]\n'))
  await writeFile(path.join(blog, 'src/contents/ai-daily/2026-02-03.md'), '---\ntitle: 日报条目\npublished: 2026-02-03\nsummary: 摘要\ntags: [AI]\n---\n\n日报内容\n')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const row = (title: string) => page.locator('.article-row').filter({ has: page.getByRole('button', { name: `查看文章：${title}`, exact: true }) })
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章库' })).toBeVisible()

    // 正文：标题下只有标签，没有「正文」二字，也不重复分类。
    await expect(row('带标签的正文').locator('.article-detail')).toHaveText('Java / Spring Boot')
    await expect(row('带标签的正文').locator('.article-subtitle')).not.toContainText('正文')
    await expect(row('带标签的正文').locator('.article-subtitle')).not.toContainText('后端')
    await expect(row('带标签的正文').locator('.category-cell')).toHaveText('后端')

    // 没有标签的正文：整行省略，不补 MD 或分类。
    await expect(row('没有标签的正文').locator('.article-subtitle')).toHaveCount(0)
    await expect(row('没有标签的正文').locator('.article-detail')).toHaveCount(0)

    // 草稿：同样只写标签，不写「草稿」。
    await expect(row('带标签的草稿').locator('.article-detail')).toHaveText('Astro')
    await expect(row('带标签的草稿').locator('.article-subtitle')).not.toContainText('草稿')

    // AI 日报保持类型前缀，便于在「全部内容」里区分。
    await expect(row('日报条目').locator('.article-detail')).toHaveText('AI 日报 · AI')
    await page.screenshot({ path: testInfo.outputPath('list-detail.png'), animations: 'disabled' })
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-list-detail-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
