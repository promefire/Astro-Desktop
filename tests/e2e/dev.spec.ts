import { test, expect, chromium } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir } from 'node:fs/promises'
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

test('development command starts a desktop window with working React and IPC', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'astro-desktop-dev-test-'))
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
    await mkdir(path.resolve('docs/images'), { recursive: true })
    await page.screenshot({ path: path.resolve('docs/images/welcome.png'), fullPage: true })
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
  }
})
