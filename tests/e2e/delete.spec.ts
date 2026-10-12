import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('article menu deletes a file only after confirmation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-delete-e2e-'))
  const blog = path.join(root, '中文 删除博客')
  const draft = path.join(blog, 'src/contents/drafts/待删.md')
  const kept = path.join(blog, 'src/contents/post/保留.md')
  await mkdir(path.dirname(draft), { recursive: true })
  await mkdir(path.dirname(kept), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(draft, '---\ntitle: 待删草稿\npublished: 2026-01-01\n---\n草稿\n')
  await writeFile(kept, '---\ntitle: 保留正文\npublished: 2026-01-02\n---\n正文\n')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看文章：待删草稿', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '文章操作：待删草稿', exact: true }).click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '确认删除文章' })
    await expect(dialog).toContainText('src/contents/drafts/待删.md')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(await readFile(draft, 'utf8')).toContain('待删草稿')
    await page.getByRole('button', { name: '文章操作：待删草稿', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '文章操作：待删草稿', exact: true }).click()
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()
    await dialog.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看文章：待删草稿', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '查看文章：保留正文', exact: true })).toBeVisible()
    await expect(readFile(draft, 'utf8')).rejects.toThrow()
    expect(await readFile(kept, 'utf8')).toContain('保留正文')
    expect(errors).toEqual([])
  } finally {
    await app.close()
    const target = path.resolve(root)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-delete-e2e-')) await rm(target, { recursive: true, force: true })
  }
})
