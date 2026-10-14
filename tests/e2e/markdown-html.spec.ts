import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const article = '---\ntitle: HTML 测试\npublished: 2026-01-01\n---\n\n<div class="box">彩色块</div>\n\n旁边的段落\n'

test('markdown setting toggles sanitized html preview without rewriting the file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-html-e2e-'))
  const blog = path.join(root, '中文 博客')
  const file = path.join(blog, 'src/contents/post/html.md')
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(file, article)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await page.getByRole('button', { name: '查看文章：HTML 测试', exact: true }).click()
    await expect(page.locator('.mu-disable-html-render')).toHaveCount(1)
    await expect(page.locator('.mu-html-preview')).toBeHidden()
    expect(await readFile(file, 'utf8')).toBe(article)

    await page.getByRole('link', { name: /项目设置/ }).click()
    const htmlSwitch = page.getByRole('switch', { name: '启用 HTML 支持', exact: true })
    await expect(htmlSwitch).toHaveAttribute('aria-checked', 'false')
    await htmlSwitch.click()
    await expect(htmlSwitch).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('link', { name: /全部内容/ }).click()
    await page.locator('#editor-wysiwyg-panel').getByText('旁边的段落', { exact: true }).click()
    await expect(page.locator('.mu-disable-html-render')).toHaveCount(0)
    await expect(page.locator('.mu-html-preview')).toBeVisible()
    await expect(page.locator('.mu-html-preview')).toContainText('彩色块')
    expect(await readFile(file, 'utf8')).toBe(article)

    await page.getByRole('link', { name: /项目设置/ }).click()
    await htmlSwitch.click()
    await expect(htmlSwitch).toHaveAttribute('aria-checked', 'false')
    await page.getByRole('link', { name: /全部内容/ }).click()
    await expect(page.locator('.mu-disable-html-render')).toHaveCount(1)
    expect(await readFile(file, 'utf8')).toBe(article)
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-html-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
