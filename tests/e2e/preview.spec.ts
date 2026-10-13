import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

test('local preview starts through the desktop and does not replace unsaved text', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-preview-e2e-'))
  const blog = path.join(root, '中文 测试博客')
  const file = path.join(blog, 'src/contents/post/预览.md')
  await mkdir(path.dirname(file), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await mkdir(path.join(blog, 'node_modules/astro'), { recursive: true })
  await writeFile(path.join(blog, 'node_modules/astro/package.json'), JSON.stringify({ name: 'astro', version: '5.0.0-test' }))
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' }, scripts: { predev: 'node predev.js', dev: 'node server.js' } }))
  await writeFile(path.join(blog, 'predev.js'), "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'predev-ran.txt'), 'ran')\n")
  await writeFile(path.join(blog, 'server.js'), "const http=require('node:http'); const server=http.createServer((_req,res)=>{res.writeHead(200);res.end('preview-ok')}); server.listen(0,'127.0.0.1',()=>{console.log('Local    http://127.0.0.1:'+server.address().port+'/')})\n")
  const original = '---\r\ntitle: 预览测试\r\npublished: 2026-01-01\r\ndraft: true\r\n---\r\n正文\r\n'
  await writeFile(file, original)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const opened: string[] = []
  await app.evaluate(({ shell }) => {
    const bucket = globalThis as { __astroOpenedUrls?: string[] }
    bucket.__astroOpenedUrls = []
    shell.openExternal = async (url: string) => { bucket.__astroOpenedUrls?.push(url) }
  })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看文章：预览测试', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '本地预览', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '本地预览' })
    await expect(panel).toContainText('Markdown 基础预览')
    await panel.getByRole('button', { name: '启动本地预览', exact: true }).click()
    await expect(panel.locator('[data-preview-phase="running"]')).toBeVisible({ timeout: 20_000 })
    await expect(panel).toContainText('127.0.0.1')
    expect(await readFile(path.join(blog, 'predev-ran.txt'), 'utf8')).toBe('ran')
    await page.screenshot({ path: path.join(testInfo.outputDir, 'preview-running.png'), animations: 'disabled' })
    await page.screenshot({ path: path.resolve('docs/images/preview-running.png'), animations: 'disabled' })
    const url = (await panel.locator('.preview-url').innerText()).match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0] ?? ''
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    await panel.getByRole('button', { name: '在浏览器打开', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as { __astroOpenedUrls?: string[] }).__astroOpenedUrls ?? [])).toContain(url)
    await panel.getByRole('button', { name: '停止预览', exact: true }).click()
    await expect(panel.locator('[data-preview-phase="idle"]')).toBeVisible()
    await expect(fetch(url)).rejects.toThrow()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '查看文章：预览测试', exact: true }).click()
    const sourceEditor = page.getByLabel('文章编辑器')
    await sourceEditor.click()
    await page.keyboard.insertText('UNSAVED')
    await page.getByRole('button', { name: '在站点中预览', exact: true }).click()
    const leave = page.getByRole('dialog', { name: '在站点中预览' })
    await expect(leave).toContainText('保存失败或发生冲突时不会打开')
    await leave.getByRole('button', { name: '取消', exact: true }).click()
    expect(await readFile(file, 'utf8')).toBe(original)
    await expect(sourceEditor).toContainText('UNSAVED')
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(() => { const preview = (globalThis as { __previewShutdown?: () => void }).__previewShutdown; preview?.() }).catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    if (path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith('astro-preview-e2e-')) await rm(root, { recursive: true, force: true })
  }
})
