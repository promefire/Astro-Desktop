import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const opacityOf = (page: Page, selector: string) => page.locator(selector).evaluate(element => getComputedStyle(element).opacity)
const distance = (left: number, right: number) => Math.abs(left - right)

/**
 * A point inside the handle's reveal zone but outside the visible pill: 10px beyond the edge
 * that faces the empty side of the layout (left of the inspector handle, right of the sidebar handle).
 */
async function nearHandle(page: Page, selector: string, side: 'left' | 'right') {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`没有找到 ${selector}`)
  return { x: side === 'left' ? box.x - 10 : box.x + box.width + 10, y: box.y + box.height / 2 }
}

test('reveals both edge handles only near the pointer and starts with both panels open', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-handles-e2e-'))
  const blog = path.join(root, '中文 博客')
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, 'src/contents/post/手柄测试.md'), '---\ntitle: 手柄测试\npublished: 2026-02-03 04:05:06\ntags: [Astro]\n---\n\n正文内容。\n')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    const viewport = page.viewportSize()
    const away = { x: (viewport?.width ?? 1200) / 2, y: (viewport?.height ?? 800) * 0.72 }
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()

    // 默认两侧都是展开的，手柄都不可见。
    await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible()
    expect((await page.locator('.sidebar').boundingBox())!.width).toBeGreaterThan(150)
    await page.mouse.move(away.x, away.y)
    await expect.poll(() => opacityOf(page, '.sidebar-toggle')).toBe('0')

    // 指针移到手柄附近（手柄外侧的扩展区域）才出现。
    const nearSidebar = await nearHandle(page, '.sidebar-toggle', 'right')
    await page.mouse.move(nearSidebar.x, nearSidebar.y)
    await expect.poll(() => opacityOf(page, '.sidebar-toggle')).toBe('1')
    await page.screenshot({ path: testInfo.outputPath('sidebar-handle-hover.png'), animations: 'disabled' })
    await page.mouse.move(away.x, away.y)
    await expect.poll(() => opacityOf(page, '.sidebar-toggle')).toBe('0')

    // 打开文章后右侧属性栏默认展开，它的手柄同样只在指针靠近时出现。
    await page.getByRole('button', { name: '查看文章：手柄测试', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toBeVisible()
    await page.mouse.move(away.x, away.y)
    await expect.poll(() => opacityOf(page, '.inspector-toggle')).toBe('0')
    const near = await nearHandle(page, '.inspector-toggle', 'left')
    await page.mouse.move(near.x, near.y)
    await expect.poll(() => opacityOf(page, '.inspector-toggle')).toBe('1')
    await page.screenshot({ path: testInfo.outputPath('inspector-handle-hover.png'), animations: 'disabled' })
    await page.mouse.move(away.x, away.y)
    await expect.poll(() => opacityOf(page, '.inspector-toggle')).toBe('0')

    // 隐藏状态下仍然可以点击收起，收起后手柄停在边缘，指针靠近还能再展开。
    await page.locator('.inspector-toggle').click()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toHaveCount(0)
    await expect.poll(async () => {
      const box = (await page.locator('.inspector-toggle').boundingBox())!
      const layout = (await page.locator('.library-layout').boundingBox())!
      return distance(box.x + box.width, layout.x + layout.width)
    }).toBeLessThanOrEqual(1.5)
    await page.locator('.inspector-toggle').click()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-handles-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
