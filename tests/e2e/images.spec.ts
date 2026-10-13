import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('imports a local image beside a draft, renders it, and notices an external file', async ({}, testInfo) => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astro-image-e2e-'))
  const blog = path.join(temporary, '中文 图片博客')
  await mkdir(path.join(blog, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(blog, 'src/contents/ai-daily/日报.md'), '---\ntitle: 日报\npublished: 2026-01-01\n---\n日报\n')
  const image = path.join(temporary, 'shot.png')
  await writeFile(image, png)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(temporary, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await app.evaluate(({ dialog }, paths) => {
      let opened = false
      dialog.showOpenDialog = async () => {
        const next = opened ? paths.image : paths.blog
        opened = true
        return { canceled: false, filePaths: [next] }
      }
    }, { blog, image })
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await page.getByRole('button', { name: '新建文章', exact: true }).click()
    const modal = page.getByRole('dialog', { name: '创建新文章' })
    await modal.getByLabel('文章标题').fill('我的 文章')
    await modal.getByRole('button', { name: '创建草稿', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章编辑工作区' })).toBeVisible()
    await page.getByRole('button', { name: '插入图片', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
    await expect(page.locator('.article-editor')).toContainText('文章同名图片目录')
    const article = path.join(blog, 'src/contents/drafts/我的 文章.md')
    const stored = path.join(blog, 'src/contents/drafts/我的 文章/shot.png')
    expect(await readFile(stored)).toEqual(png)
    await page.getByRole('tab', { name: '预览' }).click()
    await expect(page.locator('.markdown-preview img').first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('image-preview.png') })
    await page.getByRole('button', { name: '保存', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    const source = await readFile(article, 'utf8')
    expect(source.indexOf('---')).toBeLessThan(source.indexOf('shot.png'))
    expect(source).toContain('./%E6%88%91%E7%9A%84%20%E6%96%87%E7%AB%A0/')
    expect(source.match(/shot\.png/g)).toHaveLength(1)
    expect(source).not.toContain('draft:')
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.locator('a[href="#/library/daily"]').click()
    await page.getByRole('button', { name: '查看文章：日报', exact: true }).click()
    await expect(page.getByRole('button', { name: '插入图片', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await writeFile(path.join(blog, 'src/contents/drafts/外部新增.md'), '---\ntitle: 外部新增\n---\n新文件\n')
    await page.locator('a[href="#/library/drafts"]').click()
    await expect(page.getByRole('button', { name: '查看文章：外部新增', exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    const target = path.resolve(temporary)
    if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-image-e2e-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})
