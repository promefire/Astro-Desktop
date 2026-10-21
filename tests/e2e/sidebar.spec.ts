import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Read the rendered geometry, so the handle can be checked against the sidebar edge it belongs to. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null
    const sidebar = rect('.sidebar')!
    const handle = rect('.sidebar-toggle')
    return {
      sidebarLeft: sidebar.left, sidebarRight: sidebar.right, sidebarWidth: sidebar.width,
      sidebarCenterY: sidebar.top + sidebar.height / 2,
      handleLeft: handle?.left ?? null, handleCenterX: handle ? handle.left + handle.width / 2 : null,
      handleCenterY: handle ? handle.top + handle.height / 2 : null,
    }
  })
}

const distance = (left: number | null, right: number | null) => Math.abs((left ?? Number.NaN) - (right ?? Number.NaN))

test('collapses the left sidebar to icons from a handle on its right edge', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-sidebar-e2e-'))
  const blog = path.join(root, '中文 博客')
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, 'src/contents/post/侧栏测试.md'), '---\ntitle: 侧栏测试\npublished: 2026-02-03 04:05:06\ntags: [Astro]\n---\n\n正文内容。\n')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    const sidebar = page.getByRole('complementary', { name: '主导航' })
    const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true })
    await expect(sidebar).toBeVisible()
    await expect(page.getByRole('link', { name: '全部内容', exact: true })).toBeVisible()

    // 展开时：手柄跨在侧边栏右边缘，垂直居中。
    const expanded = await geometry(page)
    expect(expanded.sidebarWidth).toBeGreaterThan(150)
    expect(expanded.handleCenterY).not.toBeNull()
    expect(distance(expanded.handleCenterY, expanded.sidebarCenterY)).toBeLessThanOrEqual(1.5)
    expect(distance(expanded.handleCenterX, expanded.sidebarRight)).toBeLessThanOrEqual(1.5)
    await page.screenshot({ path: testInfo.outputPath('sidebar-expanded.png'), animations: 'disabled' })

    await collapse.click()
    const expand = page.getByRole('button', { name: '展开侧边栏', exact: true })
    await expect(expand).toBeVisible()
    await expect(collapse).toHaveCount(0)

    // 收缩后：只剩图标，文字和计数隐藏，宽度收紧，手柄跟着贴到新的右边缘。
    await expect(page.locator('.nav-item > span').first()).toBeHidden()
    await expect(page.getByText('内容库')).toBeHidden()
    await expect(page.locator('.sidebar-caption')).toHaveCount(0)
    // 当前存在的内容库入口加文章统计，底部项目设置和主题切换图标全部保留。
    await expect(page.locator('.main-nav .nav-item svg')).toHaveCount(4)
    await expect(page.locator('.sidebar-bottom .nav-item svg')).toHaveCount(2)
    await expect(page.getByRole('button', { name: '切换深色模式', exact: true })).toBeVisible()
    await expect(page.locator('.sidebar-toggle svg')).toHaveCount(1)
    await expect.poll(async () => (await geometry(page)).sidebarWidth).toBeLessThanOrEqual(70)
    const collapsed = await geometry(page)
    expect(distance(collapsed.handleCenterX, collapsed.sidebarRight)).toBeLessThanOrEqual(1.5)
    expect(distance(collapsed.handleCenterY, expanded.handleCenterY)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('sidebar-collapsed.png'), animations: 'disabled' })

    // 图标仍然可用：用无障碍名称点开文章统计。
    await page.getByRole('link', { name: '文章统计', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章统计' })).toBeVisible()

    await expand.click()
    await expect.poll(async () => (await geometry(page)).sidebarWidth).toBeGreaterThan(150)
    await expect(page.getByRole('link', { name: '全部内容', exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-sidebar-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
