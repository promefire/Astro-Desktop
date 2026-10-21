import { test, expect, chromium } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('No debug port'))
      server.close(() => resolve(address.port))
    })
  })
}

test('development command opens article bodies through StrictMode remounts', async ({}, testInfo) => {
  const profile = await mkdtemp(path.join(tmpdir(), 'astro-desktop-dev-test-'))
  const blog = path.join(profile, 'blog')
  const posts = path.join(blog, 'src/contents/post')
  await mkdir(posts, { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  const first = ('---\ntitle: 正文挂载回归\n---\n# 开头标题\n\n正文必须显示在编辑器里。\n\n' + Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段正文。\n\n`).join('') + '文章末尾标记\n').replace(/\n/g, '\r\n')
  const second = '---\ntitle: 第二篇文章\n---\n第二篇的独立正文\n'
  await writeFile(path.join(posts, 'first.md'), first)
  await writeFile(path.join(posts, 'second.md'), second)
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ version: 1, theme: 'light', recentProjects: [{ path: blog, name: '测试博客', lastOpened: new Date().toISOString() }], lastProjectPath: null }))
  const port = await freePort()
  let rendererPort = await freePort()
  while (rendererPort === port) rendererPort = await freePort()
  const env = { ...process.env, ASTRO_DESKTOP_USER_DATA: profile, ASTRO_DESKTOP_DEV_PORT: String(rendererPort) }
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE
  const child = spawn(process.execPath, [path.resolve('node_modules/electron-vite/bin/electron-vite.js'), 'dev', '--remoteDebuggingPort', String(port)], {
    cwd: path.resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error(`Development process exited with ${child.exitCode}`)
      try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
    }, { timeout: 40000, message: 'Electron development debug endpoint must start' }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 })
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    page.on('console', (message) => { if (message.type() === 'error') output += `\nRenderer console: ${message.text()}` })
    page.on('pageerror', (error) => { output += `\nRenderer error: ${error.message}` })
    await expect(page.getByRole('button', { name: '选择博客目录', exact: true })).toBeVisible({ timeout: 30000 })
    expect(page.url()).toBe(`http://127.0.0.1:${rendererPort}/`)
    const settings = await page.evaluate(() => window.astroDesktop!.getSettings())
    expect(settings.ok).toBe(true)
    expect(output).not.toMatch(/Refused to execute inline script|Unable to load preload|ERR_CONNECTION_REFUSED/)
    const opened = await page.evaluate(blog => window.astroDesktop!.openRecentProject(blog), blog)
    expect(opened.ok).toBe(true)
    await page.reload()
    await page.getByRole('button', { name: '查看文章：正文挂载回归', exact: true }).click()
    const host = page.locator('.muya-editor-host')
    await expect(host).toContainText('正文必须显示在编辑器里。', { timeout: 5000 })
    await expect(host.locator('.mu-editor')).toHaveCount(1)
    await expect(host.locator('h1')).toContainText('开头标题')
    expect(await host.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop })).toBeGreaterThan(0)
    await expect(host.getByText('文章末尾标记', { exact: true })).toBeInViewport()
    await host.evaluate(element => { element.scrollTop = 0 })
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    await page.getByRole('link', { name: '项目设置', exact: true }).click()
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await page.goBack()
    expect(await host.locator('.mu-container').evaluate(element => getComputedStyle(element).color)).toBe(await page.locator('.article-editor').evaluate(element => getComputedStyle(element).color))
    await page.screenshot({ path: testInfo.outputPath('muya-development.png') })
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('button', { name: '查看文章：第二篇文章', exact: true }).click()
    await expect(host).toContainText('第二篇的独立正文')
    await expect(host).not.toContainText('正文必须显示在编辑器里。')
    await expect(host.locator('.mu-editor')).toHaveCount(1)
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('button', { name: '查看文章：正文挂载回归', exact: true }).click()
    await expect(host).toContainText('正文必须显示在编辑器里。')
    expect(await readFile(path.join(posts, 'first.md'), 'utf8')).toBe(first)
    expect(await readFile(path.join(posts, 'second.md'), 'utf8')).toBe(second)
    await page.evaluate(() => window.close())
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nDevelopment output:\n${output}`)
  } finally {
    // The CLI owns this single Electron process. Closing its only window closes Vite too.
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise<void>(resolve => setTimeout(resolve, 3000))])
    if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* The window close may already have ended the process. */ }
      }
      else child.kill()
    }
    await browser?.close()
    const target = path.resolve(profile)
    if (path.dirname(target) === path.resolve(tmpdir()) && path.basename(target).startsWith('astro-desktop-dev-test-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
