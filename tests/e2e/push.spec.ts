import { test, expect, _electron as electron } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const git = (at: string, ...args: string[]) => execute('git', ['-C', at, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).then(result => result.stdout.trimEnd())
const bare = (repository: string, ...args: string[]) => execute('git', ['--git-dir', repository, '-c', 'core.quotepath=false', ...args], { windowsHide: true }).then(result => result.stdout.trimEnd())

const article = (title: string) => `---\ntitle: ${title}\npublished: 2026-02-03\ntags: [Astro]\n---\n\n正文\n`
const daily = '---\ntitle: 日报\npublished: 2026-02-04\nsummary: 摘要\n---\n\n日报\n'

test('pulls the remote first, then commits and pushes the listed files', async ({}, testInfo) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astro-push-e2e-'))
  const origin = path.join(temporary, 'origin.git')
  const blog = path.join(temporary, '中文 博客')
  const post = 'src/contents/post/已有文章.md'
  await execute('git', ['init', '--bare', '-q', '-b', 'main', origin], { windowsHide: true })
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, post), article('已有文章'))
  await git(blog, 'init', '-b', 'main')
  await git(blog, 'config', 'user.name', 'Test')
  await git(blog, 'config', 'user.email', 'test@example.invalid')
  // 本地改动与服务器提交各改一处，模拟日报由服务器产生。
  await git(blog, 'add', '.')
  await git(blog, 'commit', '-m', '初始提交')
  await git(blog, 'remote', 'add', 'origin', origin)
  await git(blog, 'push', 'origin', 'main')
  const machine = path.join(temporary, '服务器')
  await execute('git', ['clone', '-q', origin, machine], { windowsHide: true })
  await git(machine, 'config', 'user.name', 'Server')
  await git(machine, 'config', 'user.email', 'server@example.invalid')
  await mkdir(path.join(machine, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(machine, 'src/contents/ai-daily/2026-02-04.md'), daily)
  await git(machine, 'add', '.')
  await git(machine, 'commit', '-m', '服务器日报')
  await git(machine, 'push', 'origin', 'main')
  await writeFile(path.join(blog, 'src/contents/post/新文章.md'), article('新文章'))

  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(temporary, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await page.getByRole('button', { name: '推送', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: '推送本地修改' })
    await expect(dialog).toBeVisible()
    // 打开时就已经拉取：服务器的日报落到本地，且列出的是拉取之后的工作区改动。
    await expect(dialog.locator('.sync-list')).toContainText('src/contents/post/新文章.md')
    // 检出时 Git 可能按 core.autocrlf 改写换行，这里只比较内容。
    expect((await readFile(path.join(blog, 'src/contents/ai-daily/2026-02-04.md'), 'utf8')).replaceAll('\r\n', '\n')).toBe(daily)
    await expect(dialog.locator('.sync-context')).toContainText('main')
    await page.screenshot({ path: testInfo.outputPath('push-dialog.png'), animations: 'disabled' })

    const confirm = dialog.getByRole('button', { name: '确认推送', exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('提交信息').fill('更新文章与日报')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(dialog.locator('.sync-done')).toContainText('已推送')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '推送本地修改' })).toHaveCount(0)

    expect(await bare(origin, 'log', '--format=%s', '-1')).toBe('更新文章与日报')
    const pushed = await bare(origin, 'ls-tree', '-r', '--name-only', 'HEAD')
    expect(pushed).toContain('src/contents/post/新文章.md')
    expect(pushed).toContain('src/contents/post/已有文章.md')
    expect(pushed).toContain('src/contents/ai-daily/2026-02-04.md')
    // 推送后工作区干净：列表里的新文章已经进入提交。
    expect(await git(blog, 'status', '--porcelain=v1')).toBe('')
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(temporary)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-push-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
