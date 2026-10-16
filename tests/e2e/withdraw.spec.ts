import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('withdraws a post back into the draft directory without committing it', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astro-withdraw-e2e-'))
  const blog = path.join(temporary, '中文 撤回博客')
  const original = '---\ntitle: 待撤回\npublished: 2026-02-03 04:05:06\ncategory: 后端\ntags: [Astro]\n---\n\n正文开头。\n'
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, 'src/contents/post/待撤回.md'), original)
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
    await page.getByRole('button', { name: '查看文章：待撤回', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章编辑工作区' })).toBeVisible()
    const withdraw = page.getByRole('button', { name: '撤回为草稿', exact: true })
    await expect(withdraw).toBeVisible()
    await page.locator('.muya-editor-host').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('还没保存')
    await withdraw.click()
    const prompt = page.getByRole('dialog', { name: '撤回为草稿' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: '取消', exact: true }).click()
    expect(await readFile(path.join(blog, 'src/contents/post/待撤回.md'), 'utf8')).not.toContain('还没保存')
    await expect(readFile(path.join(blog, 'src/contents/drafts/待撤回.md'), 'utf8')).rejects.toThrow()
    await withdraw.click()
    await prompt.getByRole('button', { name: '放弃修改并撤回', exact: true }).click()
    await expect(page.locator('.editor-heading-title')).toContainText('src/contents/drafts/待撤回.md')
    const withdrawn = await readFile(path.join(blog, 'src/contents/drafts/待撤回.md'), 'utf8')
    expect(withdrawn).not.toContain('还没保存')
    expect(withdrawn).not.toContain('draft:')
    await expect(readFile(path.join(blog, 'src/contents/post/待撤回.md'), 'utf8')).rejects.toThrow()
    await expect(page.getByRole('button', { name: '发布到正文', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '撤回为草稿', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('link', { name: '文章统计' }).click()
    await expect(page.getByRole('button', { name: '查看正文，0 篇' })).toBeVisible()
    await expect(page.getByRole('button', { name: '查看草稿，1 篇' })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(temporary)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-withdraw-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
