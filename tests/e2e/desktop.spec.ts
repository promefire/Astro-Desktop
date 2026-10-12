import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, readdir, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const blogPath = process.env.ASTRO_BLOG_TEST_PATH ?? 'F:\\blog\\Astro_Blog'
const projectRoot = path.resolve('.')

async function fingerprint(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files[path.relative(directory, target)] = createHash('sha256').update(await readFile(target)).digest('hex')
    }
  }
  await visit(directory)
  return files
}

async function launch(profile: string): Promise<ElectronApplication> {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  return electron.launch({ args: [projectRoot], env })
}

test('real blog: secure IPC, metadata, UI filters, source fidelity and restart persistence', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'astro-desktop-e2e-'))
  const contents = path.join(blogPath, 'src/contents')
  const before = await fingerprint(contents)
  const gitBefore = execFileSync('git', ['-C', blogPath, '-c', 'core.fsmonitor=false', 'status', '--porcelain'], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  let app = await launch(profile)
  try {
    let page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await expect(page.getByRole('button', { name: '选择博客目录', exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, blogPath)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.astroDesktop!.getProject()
      return result.ok ? result.data?.path : null
    })).toBe(path.resolve(blogPath))

    const index = await page.evaluate(() => window.astroDesktop!.listArticles())
    expect(index.ok).toBe(true)
    if (!index.ok) throw new Error(index.error)
    const expectedPost = Object.keys(before).filter((file) => /^post[\\/].*\.mdx?$/i.test(file)).length
    const expectedDaily = Object.keys(before).filter((file) => /^ai-daily[\\/].*\.md$/i.test(file)).length
    expect(index.data.articles.filter((a) => a.kind === 'post')).toHaveLength(expectedPost)
    expect(index.data.articles.filter((a) => a.kind === 'ai-daily')).toHaveLength(expectedDaily)
    expect(index.data.issues).toEqual([])
    expect(index.data.articles.flatMap((a) => a.issues)).toEqual([])
    expect(index.data.articles.filter((a) => a.kind === 'ai-daily').every((a) => a.draft === null)).toBe(true)
    const mdx = index.data.articles.find((a) => a.extension === '.mdx')!
    expect(mdx).toBeDefined()
    const document = await page.evaluate((relative) => window.astroDesktop!.readArticle(relative), mdx.relativePath)
    expect(document.ok).toBe(true)
    if (document.ok) expect(document.data.source).toBe(await readFile(path.join(blogPath, mdx.relativePath), 'utf8'))

    const escaped = await page.evaluate(() => window.astroDesktop!.readArticle('../package.json'))
    expect(escaped.ok).toBe(false)
    const arbitrary = await page.evaluate(() => window.astroDesktop!.openRecentProject('C:\\Windows'))
    expect(arbitrary.ok).toBe(false)
    expect(await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, ipc: 'ipcRenderer' in window }))).toEqual({ node: 'undefined', ipc: false })
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences }
      const prefs = contents.getLastWebPreferences()
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }
    })
    expect(preferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })

    await expect(page.locator('body')).toContainText('Astro_Blog')
    await page.getByLabel('搜索文章', { exact: true }).fill(mdx.title)
    await expect(page.locator('.article-row')).toHaveCount(1)
    const mdxRow = page.getByRole('button', { name: `查看文章：${mdx.title}`, exact: true })
    await mdxRow.click()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toContainText(mdx.category!)
    await page.getByRole('tab', { name: '源码', exact: true }).click()
    await expect(page.getByLabel('文章源码编辑器')).toBeVisible()
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '刷新文章', exact: true }).click()
    await expect(page.getByLabel('文章源码编辑器')).toBeVisible()
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByLabel('搜索文章', { exact: true }).fill('not-a-real-article-938471')
    await expect(page.getByText('没有匹配的内容', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '清除筛选', exact: true }).click()
    await page.getByLabel('按分类筛选').selectOption(mdx.category!)
    await expect(page.locator('.filter-total')).toHaveText(`${index.data.articles.filter((a) => a.category === mdx.category).length} 篇内容`)
    await page.getByLabel('按标签筛选').selectOption(mdx.tags[0])
    await expect(page.locator('.filter-total')).toHaveText(`${index.data.articles.filter((a) => a.category === mdx.category && a.tags.includes(mdx.tags[0])).length} 篇内容`)
    await page.getByRole('button', { name: '清除筛选', exact: true }).click()
    await page.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(page.locator('.pagination')).toContainText('2 /')
    await page.getByRole('button', { name: '上一页', exact: true }).click()
    await page.getByLabel('文章排序').selectOption('published-asc')
    const oldest = [...index.data.articles].sort((a, b) => (a.published ?? '').localeCompare(b.published ?? ''))[0]
    await expect(page.locator('.article-row').first()).toHaveAccessibleName(`查看文章：${oldest.title}`)
    await page.getByLabel('文章排序').selectOption('published-desc')
    await page.locator('a[href="#/library/daily"]').click()
    await expect(page.locator('.article-row')).toHaveCount(expectedDaily)
    await page.locator('.article-row').first().click()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toContainText('不适用')
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toContainText('日报摘要')
    await mkdir(path.join(projectRoot, 'docs/images'), { recursive: true })
    await page.screenshot({ path: path.join(projectRoot, 'docs/images/desktop-light.png'), fullPage: true })
    await page.locator('a[href="#/library/all"]').click()
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.article-row')).toHaveCount(12)
    await app.close()
    app = await launch(profile)
    page = await app.firstWindow()
    await expect.poll(async () => page.evaluate(async () => {
      const result = await window.astroDesktop!.getProject()
      return result.ok ? result.data?.path : null
    })).toBe(path.resolve(blogPath))
    const restored = await page.evaluate(() => window.astroDesktop!.getSettings())
    expect(restored.ok && restored.data.theme).toBe('dark')
    expect(restored.ok && restored.data.recentProjects[0].path).toBe(path.resolve(blogPath))
    await expect(page.locator('body')).toContainText('Astro_Blog')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.article-row')).toHaveCount(12)
    await page.locator('.article-row').first().click()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toContainText('Git 状态')
    await page.screenshot({ path: path.join(projectRoot, 'docs/images/desktop-dark.png'), fullPage: true })
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.locator('.article-row')).toHaveCount(12)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, projectRoot)
    await page.getByRole('button', { name: '打开项目', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('astro 依赖')
    expect(await page.evaluate(async () => {
      const result = await window.astroDesktop!.getProject()
      return result.ok ? result.data?.path : null
    })).toBe(path.resolve(blogPath))
    expect(pageErrors).toEqual([])
  } finally {
    await app.close()
    expect(await fingerprint(contents)).toEqual(before)
    const gitAfter = execFileSync('git', ['-C', blogPath, '-c', 'core.fsmonitor=false', 'status', '--porcelain'], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    expect(gitAfter).toBe(gitBefore)
  }
})
