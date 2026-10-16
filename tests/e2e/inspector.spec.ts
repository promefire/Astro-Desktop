import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Read the geometry the renderer actually produced, so the handle can be checked against the panel it belongs to. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null
    const layout = rect('.library-layout')!
    const handle = rect('.inspector-toggle')
    const panel = rect('.inspector')
    const library = rect('.library')
    return {
      layoutLeft: layout.left, layoutRight: layout.right, layoutCenterY: layout.top + layout.height / 2,
      handleLeft: handle?.left ?? null, handleRight: handle?.right ?? null,
      handleCenterY: handle ? handle.top + handle.height / 2 : null,
      handleCenterX: handle ? handle.left + handle.width / 2 : null,
      panelLeft: panel?.left ?? null, libraryRight: library?.right ?? null,
    }
  })
}

/** Nullable geometry reads make every distance explicit; a missing element must not compare as zero. */
const distance = (left: number | null, right: number | null) => Math.abs((left ?? Number.NaN) - (right ?? Number.NaN))

test('shows article properties only in the editor and moves the collapse handle with the panel', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-inspector-e2e-'))
  const blog = path.join(root, '中文 博客')
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, 'src/contents/post/属性测试.md'), '---\ntitle: 属性测试\npublished: 2026-02-03 04:05:06\ncategory: 后端\ntags: [Astro]\n---\n\n正文内容。\n')
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

    // 列表页：没有属性栏，也没有手柄，列表占满整行。
    await expect(page.getByRole('region', { name: '文章库' })).toBeVisible()
    await expect(page.getByRole('region', { name: '文章属性', exact: true })).toHaveCount(0)
    await expect(page.getByText('选择一篇内容')).toHaveCount(0)
    const listed = await geometry(page)
    expect(listed.handleLeft).toBeNull()
    expect(distance(listed.libraryRight, listed.layoutRight)).toBeLessThanOrEqual(1.5)
    await page.screenshot({ path: testInfo.outputPath('inspector-list.png'), animations: 'disabled' })

    await page.getByRole('button', { name: '查看文章：属性测试', exact: true }).click()
    const inspector = page.getByRole('region', { name: '文章属性', exact: true })
    const collapse = page.getByRole('button', { name: '收起文章属性', exact: true })
    await expect(inspector).toBeVisible()
    await expect(collapse).toBeVisible()

    // 展开时：手柄跨在属性栏左边缘上，垂直居中。
    const expanded = await geometry(page)
    expect(expanded.panelLeft).not.toBeNull()
    expect(expanded.handleCenterY).not.toBeNull()
    expect(distance(expanded.handleCenterY, expanded.layoutCenterY)).toBeLessThanOrEqual(1.5)
    expect(distance(expanded.handleCenterX, expanded.panelLeft)).toBeLessThanOrEqual(1.5)
    await page.screenshot({ path: testInfo.outputPath('inspector-expanded.png'), animations: 'disabled' })

    await collapse.click()
    await expect(inspector).toHaveCount(0)
    await expect(collapse).toHaveCount(0)
    const expand = page.getByRole('button', { name: '展开文章属性', exact: true })
    await expect(expand).toBeVisible()

    // 收起后：手柄跟着滑到右边缘并完整可见，垂直位置不变。
    await expect.poll(async () => distance((await geometry(page)).handleRight, listed.layoutRight)).toBeLessThanOrEqual(1.5)
    const collapsed = await geometry(page)
    expect(collapsed.handleCenterY).not.toBeNull()
    expect(distance(collapsed.handleCenterY, expanded.handleCenterY)).toBeLessThanOrEqual(1)
    expect(collapsed.handleLeft ?? 0).toBeGreaterThanOrEqual(collapsed.layoutLeft)
    await page.screenshot({ path: testInfo.outputPath('inspector-collapsed.png'), animations: 'disabled' })

    await expand.click()
    await expect(inspector).toBeVisible()
    await expect.poll(async () => {
      const restored = await geometry(page)
      return distance(restored.handleCenterX, restored.panelLeft)
    }).toBeLessThanOrEqual(1.5)

    // 返回列表后属性栏再次消失。
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章库' })).toBeVisible()
    await expect(page.locator('.inspector-toggle')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-inspector-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
