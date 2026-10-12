import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServices } from '../src/main/services'
import { ServiceError } from '../src/main/services/errors'

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined)
  for (const root of roots.splice(0)) {
    if (path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) await rm(root, { recursive: true, force: true })
  }
})

async function blog(name = '中文 预览') {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-preview-'))
  roots.push(root)
  const project = path.join(root, name)
  await mkdir(path.join(project, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(project, 'src/contents/ai-daily'), { recursive: true })
  await mkdir(path.join(project, 'node_modules/astro'), { recursive: true })
  await writeFile(path.join(project, 'node_modules/astro/package.json'), JSON.stringify({ name: 'astro', version: '5.0.0-test' }))
  await writeFile(path.join(project, 'src/contents/post/hello.md'), '---\ntitle: Hello\npublished: 2026-01-01\n---\n正文\n')
  await writeFile(path.join(project, 'src/contents/ai-daily/2026-10-08.md'), '---\ntitle: Daily\npublished: 2026-10-08\nsummary: s\n---\n正文\n')
  await writeFile(path.join(project, 'predev.js'), "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'predev-ran.txt'), 'ran')\n")
  await writeFile(path.join(project, 'server.js'), `
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const delay = fs.existsSync(path.join(__dirname, 'delay-ms.txt')) ? Number(fs.readFileSync(path.join(__dirname, 'delay-ms.txt'), 'utf8')) : 0
fs.writeFileSync(path.join(__dirname, 'electron-flag.txt'), process.env.ELECTRON_RUN_AS_NODE || 'absent')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('preview-ok') })
setTimeout(() => server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(__dirname, 'pids.json'), JSON.stringify({ server: process.pid, child: child.pid }))
  console.log('Local    http://127.0.0.1:' + server.address().port + '/')
}), delay)
`)
  await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'preview-fixture', dependencies: { astro: '^5.3.0' }, scripts: { predev: 'node predev.js', dev: 'node server.js' } }))
  const services = createServices(path.join(root, 'settings.json'))
  cleanups.push(() => services.preview.shutdown())
  await services.projects.select(project)
  return { root, project, services }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('local preview process', () => {
  it('runs predev, becomes ready only after HTTP responds, and kills the owned tree', async () => {
    const { project, services } = await blog()
    process.env.ELECTRON_RUN_AS_NODE = '1'
    const state = await services.preview.start(15_000)
    expect(state.phase).toBe('running')
    expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(await readFile(path.join(project, 'predev-ran.txt'), 'utf8')).toBe('ran')
    expect(await readFile(path.join(project, 'electron-flag.txt'), 'utf8')).toBe('absent')
    expect(await fetch(state.url!).then(response => response.text())).toBe('preview-ok')
    const pids = JSON.parse(await readFile(path.join(project, 'pids.json'), 'utf8')) as { server: number; child: number }
    await expect(services.preview.start()).rejects.toMatchObject({ code: 'PREVIEW_BUSY' })
    await services.preview.stop()
    expect(services.preview.status().phase).toBe('idle')
    expect(alive(pids.server)).toBe(false)
    expect(alive(pids.child)).toBe(false)
    await expect(fetch(state.url!)).rejects.toThrow()
  })

  it('does not disturb an unrelated server and can stop before readiness', async () => {
    const blocker = createServer((_req, res) => { res.end('other-service') })
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', () => resolve()))
    const blocked = (blocker.address() as { port: number }).port
    const { project, services } = await blog()
    await writeFile(path.join(project, 'delay-ms.txt'), '4000')
    const pending = services.preview.start(15_000)
    await expect.poll(() => services.preview.status().phase, { timeout: 15_000 }).toBe('starting')
    expect(await fetch(`http://127.0.0.1:${blocked}/`).then(response => response.text())).toBe('other-service')
    await services.preview.stop()
    expect((await pending).phase).not.toBe('running')
    expect(await fetch(`http://127.0.0.1:${blocked}/`).then(response => response.text())).toBe('other-service')
    await new Promise<void>((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()))
  })

  it('reports script failure, timeout, missing setup, and isolates projects', async () => {
    const failing = await blog()
    await writeFile(path.join(failing.project, 'fail.js'), 'process.exit(3)\n')
    await writeFile(path.join(failing.project, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' }, scripts: { predev: 'node predev.js', dev: 'node fail.js' } }))
    const failed = await failing.services.preview.start(10_000)
    expect(failed.phase).toBe('failed')
    expect(failed.exitCode).toBe(3)
    expect(await readFile(path.join(failing.project, 'predev-ran.txt'), 'utf8')).toBe('ran')
    const retry = await blog('超时 项目')
    await writeFile(path.join(retry.project, 'hang.js'), 'setInterval(() => {}, 1000)\n')
    await writeFile(path.join(retry.project, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' }, scripts: { dev: 'node hang.js' } }))
    const timedOut = await retry.services.preview.start(1_200)
    expect(timedOut.phase).toBe('failed')
    expect(timedOut.message).toContain('超时')
    const missing = await blog('缺少 脚本')
    await writeFile(path.join(missing.project, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' }, scripts: {} }))
    await rm(path.join(missing.project, 'node_modules'), { recursive: true, force: true })
    const checked = await missing.services.preview.start(5_000)
    expect(checked.phase).toBe('failed')
    expect(checked.checks.find(item => item.id === 'script')?.status).toBe('missing')
    expect(checked.checks.find(item => item.id === 'dependencies')?.status).toBe('missing')
    expect(checked.log).toBe('')
    const first = await blog('项目 甲')
    const started = await first.services.preview.start(15_000)
    expect(started.phase).toBe('running')
    const secondProject = path.join(first.root, '项目 乙')
    await mkdir(path.join(secondProject, 'src/contents/post'), { recursive: true })
    await mkdir(path.join(secondProject, 'src/contents/ai-daily'), { recursive: true })
    await writeFile(path.join(secondProject, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' }, scripts: { dev: 'astro dev' } }))
    await first.services.projects.select(secondProject)
    const switched = first.services.preview.status()
    expect(switched.projectPath).toBe((await first.services.projects.getCurrent())?.path)
    expect(switched.phase).toBe('idle')
    expect(switched.log).toBe('')
    await expect(fetch(started.url!)).rejects.toThrow()
  })

  it('rejects an invalid runtime without saving it and opens only a verified article', async () => {
    const { root, project, services } = await blog()
    await writeFile(path.join(project, 'yukina.config.ts'), 'export default { slugMode: "RAW" }\n')
    const fakeNode = path.join(root, 'bad node.exe')
    const fakeNpm = path.join(root, 'bad npm.cmd')
    await writeFile(fakeNode, 'not a program')
    await writeFile(fakeNpm, '@echo off\r\n')
    await expect(services.preview.configure(fakeNode, fakeNpm)).rejects.toBeInstanceOf(ServiceError)
    expect((await services.settings.get()).previewRuntime).toEqual({ nodePath: null, npmPath: null })
    const running = await services.preview.start(15_000)
    const opened: string[] = []
    const article = await services.preview.openArticle('src/contents/post/hello.md', async (url) => { opened.push(url) })
    expect(article.kind).toBe('opened')
    expect(new URL(article.url!).pathname).toBe('/post/hello')
    expect(opened).toEqual([article.url])
    const daily = await services.preview.openArticle('src/contents/ai-daily/2026-10-08.md', async (url) => { opened.push(url) })
    expect(daily.url).toContain('/ai-daily#daily-2026-10-08')
    await services.preview.stop()
    const stopped = await blog('无配置')
    await stopped.services.preview.start(15_000)
    const unresolved = await stopped.services.preview.openArticle('src/contents/post/hello.md', async () => { throw new Error('should not open') })
    expect(unresolved.kind).toBe('unresolved')
    expect(unresolved.homepage).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    await stopped.services.preview.shutdown()
  })

  it('launches npm.cmd from a Chinese path that contains spaces', async () => {
    const { root, services } = await blog()
    const detected = await services.preview.check()
    expect(detected.runtime?.npmPath.toLowerCase().endsWith('\\npm.cmd')).toBe(true)
    const tool = path.join(root, '中文 工具')
    await mkdir(tool, { recursive: true })
    const npmPath = path.join(tool, 'npm.cmd')
    await writeFile(npmPath, `@echo off\r\n"${detected.runtime!.npmPath}" %*\r\n`)
    const configured = await services.preview.configure(detected.runtime!.nodePath, npmPath)
    expect(configured.runtime?.source).toBe('configured')
    expect((await services.settings.get()).previewRuntime.npmPath).toBe(npmPath)
    const restarted = createServices(path.join(root, 'settings.json'))
    cleanups.push(() => restarted.preview.shutdown())
    await restarted.projects.select(path.join(root, '中文 预览'))
    const state = await restarted.preview.start(15_000)
    expect(state.phase).toBe('running')
    expect(state.runtime?.npmPath).toBe(npmPath)
    await restarted.preview.shutdown()
  })
})
