import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const article = (title: string, extra = '') => `---\ntitle: ${title}\npublished: 2026-02-03 04:05:06\n${extra}---\n\n正文内容。\n`

async function blog(root: string, name: string, sections: Array<'post' | 'drafts' | 'ai-daily'>) {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  for (const section of sections) {
    await mkdir(path.join(directory, `src/contents/${section}`), { recursive: true })
    const file = section === 'post' ? 'src/contents/post/文章.md' : section === 'drafts' ? 'src/contents/drafts/草稿.md' : 'src/contents/ai-daily/2026-02-03.md'
    const text = section === 'ai-daily' ? '---\ntitle: 日报\npublished: 2026-02-03\nsummary: 摘要\n---\n\n日报\n' : article(section === 'post' ? '文章' : '草稿')
    await writeFile(path.join(directory, file), text)
  }
  return directory
}

test('renders sidebar sections for the content directories that exist', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-sections-e2e-'))
  const full = await blog(root, '三个目录', ['post', 'drafts', 'ai-daily'])
  const noDrafts = await blog(root, '没有草稿目录', ['post', 'ai-daily'])
  const onlyPost = await blog(root, '只有正文目录', ['post'])
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const section = (name: string) => page.getByRole('link', { name, exact: true })

    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, full)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await expect(section('全部内容')).toBeVisible()
    await expect(section('正文')).toBeVisible()
    await expect(section('草稿')).toBeVisible()
    await expect(section('AI 日报')).toBeVisible()

    // 没有 src/contents/drafts 的项目：不渲染草稿入口，其他入口照常。
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, noDrafts)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.project-switcher-text strong')).toHaveText('没有草稿目录')
    await expect(section('草稿')).toHaveCount(0)
    await expect(section('全部内容')).toBeVisible()
    await expect(section('正文')).toBeVisible()
    await expect(section('AI 日报')).toBeVisible()

    // 只有 src/contents/post 的项目也能打开：正文和全部内容保留，其余入口不渲染。
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, onlyPost)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.project-switcher-text strong')).toHaveText('只有正文目录')
    await expect(section('全部内容')).toBeVisible()
    await expect(section('正文')).toBeVisible()
    await expect(section('草稿')).toHaveCount(0)
    await expect(section('AI 日报')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看文章：文章', exact: true })).toBeVisible()

    // 回到三目录项目后草稿入口重新出现，说明渲染跟随目录而不是只算一次。
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, full)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.project-switcher-text strong')).toHaveText('三个目录')
    await expect(section('草稿')).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-sections-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
