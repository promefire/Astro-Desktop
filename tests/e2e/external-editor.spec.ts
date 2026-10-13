import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

test('default Markdown app opens the real file without replacing unsaved text', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-external-e2e-'))
  const blog = path.join(root, '中文 测试博客')
  const relative = 'src/contents/post/外部.md'
  const file = path.join(blog, relative)
  await mkdir(path.dirname(file), { recursive: true })
  await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  const original = '---\r\ntitle: 外部编辑测试\r\npublished: 2026-01-01\r\ndraft: true\r\n---\r\n正文\r\n'
  await writeFile(file, original)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({ args: [path.resolve('.')], env })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const mockOpen = (mode: 'fail' | 'record') => app.evaluate(({ shell }, mode) => {
    const bucket = globalThis as { __astroOpenedPath?: string }
    bucket.__astroOpenedPath = ''
    shell.openPath = async (file: string) => {
      if (mode === 'fail') return 'No application is associated with the specified file for this operation'
      bucket.__astroOpenedPath = file
      return ''
    }
  }, mode)
  const recordedPath = () => app.evaluate(() => (globalThis as { __astroOpenedPath?: string }).__astroOpenedPath ?? '')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680))
    await mockOpen('fail')
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await expect(page.getByRole('button', { name: '查看文章：外部编辑测试', exact: true })).toBeVisible()
    await page.locator('a[href="#/settings"]').click()
    await expect(page.getByRole('heading', { name: '项目设置', exact: true })).toBeVisible()
    const editorSettings = page.locator('section[aria-label="外部编辑器"]')
    await expect(editorSettings).toContainText('不需要在这里选择编辑器')
    await page.getByRole('button', { name: '检查默认程序', exact: true }).click()
    await expect(editorSettings).toContainText(/已设置 \.md|尚未设置 \.md/)
    await page.screenshot({ path: path.join(testInfo.outputDir, 'external-editor-settings.png'), animations: 'disabled' })
    await page.screenshot({ path: path.resolve('docs/images/external-editor-settings.png'), animations: 'disabled' })
    await page.locator('a[href="#/library/all"]').click()
    await page.getByRole('button', { name: '查看文章：外部编辑测试', exact: true }).click()
    const association = await page.evaluate(() => window.astroDesktop!.checkExternalEditor())
    if (!association.ok) throw new Error(association.error)
    await page.getByRole('button', { name: '用外部编辑器打开', exact: true }).click()
    if (association.data.associations['.md'] !== 'ready') {
      await expect(page.locator('.editor-error')).toContainText('尚未为 .md')
      expect(await readFile(file, 'utf8')).toBe(original)
      await expect.poll(recordedPath).toBe('')
      expect(errors).toEqual([])
      return
    }
    await expect(page.locator('.editor-error')).toContainText('尚未为 .md')
    expect(await readFile(file, 'utf8')).toBe(original)
    await mockOpen('record')
    const sourceEditor = page.getByLabel('文章编辑器')
    await sourceEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('UNSAVED')
    await expect(page.locator('.editor-save-state')).toHaveText('未保存')
    await page.getByRole('button', { name: '用外部编辑器打开', exact: true }).click()
    const leave = page.getByRole('dialog', { name: '用外部编辑器打开' })
    await expect(leave).toBeVisible()
    await page.screenshot({ path: path.join(testInfo.outputDir, 'external-editor-unsaved.png'), animations: 'disabled' })
    await page.screenshot({ path: path.resolve('docs/images/external-editor-unsaved.png'), animations: 'disabled' })
    await leave.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.editor-save-state')).toHaveText('未保存')
    await expect(sourceEditor).toContainText('UNSAVED')
    await expect.poll(recordedPath).toBe('')
    await page.getByRole('button', { name: '用外部编辑器打开', exact: true }).click()
    await leave.getByRole('button', { name: '保存并打开', exact: true }).click()
    const guide = page.getByRole('region', { name: '正在使用外部编辑器' })
    await expect(guide).toBeVisible()
    await expect(guide).toContainText('请点击下方按钮重新加载内容')
    await expect(page.getByLabel('文章编辑器')).toBeHidden()
    await expect(page.locator('.editor-save-state')).toHaveText('外部编辑中')
    await page.keyboard.insertText('SHOULD_NOT_LAND')
    expect(await readFile(file, 'utf8')).not.toContain('SHOULD_NOT_LAND')
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    const openedPath = await recordedPath()
    expect(path.normalize(openedPath)).toBe(path.normalize(file))
    await page.screenshot({ path: path.join(testInfo.outputDir, 'external-editor-active.png'), animations: 'disabled' })
    await page.screenshot({ path: path.resolve('docs/images/external-editor-active.png'), animations: 'disabled' })
    const saved = await readFile(file)
    const edited = Buffer.concat([saved, Buffer.from('EXTERNAL_EDIT\r\n')])
    await writeFile(file, edited)
    await expect(guide).toBeVisible()
    await guide.getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(guide).toBeHidden()
    await expect(sourceEditor).toContainText('EXTERNAL_EDIT')
    await expect(sourceEditor).toContainText('UNSAVED')
    await expect(sourceEditor).not.toContainText('SHOULD_NOT_LAND')
    const newer = Buffer.concat([edited, Buffer.from('NEWER\r\n')])
    await writeFile(file, newer)
    await sourceEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('MORE')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.editor-error')).toContainText('其他程序修改')
    expect(await readFile(file)).toEqual(newer)
    expect((await readFile(file)).includes(Buffer.from('MORE'))).toBe(false)
    await page.getByRole('button', { name: '重新加载磁盘版本', exact: true }).click()
    await page.getByRole('button', { name: '保留编辑并加载', exact: true }).click()
    await expect(sourceEditor).toContainText('NEWER')
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    if (path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith('astro-external-e2e-')) await rm(root, { recursive: true, force: true })
  }
})
