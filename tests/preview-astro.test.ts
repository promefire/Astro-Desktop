import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServices } from '../src/main/services'

const execute = promisify(execFile)
let root = ''
afterEach(async () => {
  if (root && path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) await rm(root, { recursive: true, force: true })
  root = ''
})

describe('real Astro dev server', () => {
  it('installs Astro in an isolated project, serves a page, and stops the process tree', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'astro-real-preview-'))
    const project = path.join(root, '中文 Astro')
    await mkdir(path.join(project, 'src/pages'), { recursive: true })
    await mkdir(path.join(project, 'src/contents/post'), { recursive: true })
    await mkdir(path.join(project, 'src/contents/ai-daily'), { recursive: true })
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'astro-preview-fixture', dependencies: { astro: '^5.3.0' }, scripts: { predev: 'node predev.mjs', dev: 'astro dev' } }))
    await writeFile(path.join(project, 'astro.config.mjs'), "import { defineConfig } from 'astro/config'\nexport default defineConfig({ server: { host: '127.0.0.1', open: false } })\n")
    await writeFile(path.join(project, 'src/pages/index.astro'), '<html><body>astro-preview-ok</body></html>\n')
    await writeFile(path.join(project, 'predev.mjs'), "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./predev-ran.txt', import.meta.url), 'ran')\n")
    const services = createServices(path.join(root, 'settings.json'))
    await services.projects.select(project)
    const detected = await services.preview.check()
    expect(detected.checks.find(item => item.id === 'node')?.status).toBe('ok')
    expect(detected.runtime?.nodePath).toBeTruthy()
    await execute(detected.runtime!.nodePath, [path.join(path.dirname(detected.runtime!.nodePath), 'node_modules/npm/bin/npm-cli.js'), 'install', 'astro@5', '--no-audit', '--no-fund'], { cwd: project, windowsHide: true, timeout: 180_000 })
    try {
      const state = await services.preview.start(90_000)
      expect(state.phase).toBe('running')
      expect(state.url).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/)
      expect(await readFile(path.join(project, 'predev-ran.txt'), 'utf8')).toBe('ran')
      expect(await fetch(state.url!).then(response => response.text())).toContain('astro-preview-ok')
      await services.preview.stop()
      expect(services.preview.status().phase).toBe('idle')
      await expect(fetch(state.url!)).rejects.toThrow()
    } finally {
      await services.preview.shutdown()
    }
  }, 240_000)
})
