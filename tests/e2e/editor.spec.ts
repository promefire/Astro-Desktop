import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

test('editor saves real files, guards navigation, detects conflicts and restores after window loss', async ({}, testInfo) => {
  const root = await mkdtemp(path.join(tmpdir(), 'astro-editor-e2e-'))
  const blog = path.join(root, '中文 博客'), relative = 'src/contents/post/编辑.md', file = path.join(blog, relative)
  await mkdir(path.dirname(file), { recursive: true }); await mkdir(path.join(blog, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(blog, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  const original = '---\r\n# 注释\r\ntitle: 编辑测试\r\npublished: 2026-01-01\r\ndraft: true\r\ncategory: 测试\r\ntags: [Astro]\r\nextra: keep\r\n---\r\n# 标题\r\n\r\n原始摘要 内容在这里。\r\n'
  await writeFile(file, original)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined)), ASTRO_DESKTOP_USER_DATA: path.join(root, 'profile') }
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  let app = await electron.launch({ args: [path.resolve('.')], env })
  let page = await app.firstWindow()
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const editor = page.locator('.muya-editor-host')
  const append = async (page: Page, text: string) => {
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText(text)
  }
  try {
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }) }, blog)
    await page.getByRole('button', { name: '选择博客目录', exact: true }).click()
    await page.getByRole('button', { name: '查看文章：编辑测试', exact: true }).click()
    await expect(editor).toBeVisible()
    await append(page, '新增内容')
    await expect(page.locator('.editor-save-state')).toHaveText('未保存')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    // Muya 规范化正文段落间距并在末尾加换行，这里只校验语义内容
    const saved = await readFile(file, 'utf8')
    expect(saved.startsWith(original.split('\r\n---\r\n')[0] + '\r\n---\r\n')).toBe(true)
    expect(saved).toContain('新增内容')
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: testInfo.outputPath('editor-dark.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '切换浅色主题', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await append(page, '未保存导航')
    await page.locator('a[href="#/settings"]').click()
    const leave = page.getByRole('dialog', { name: '文章有未保存的修改' })
    await expect(leave).toBeVisible(); await leave.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('region', { name: '文章编辑工作区' })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(leave).toBeVisible(); await leave.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await leave.getByRole('button', { name: '放弃修改', exact: true }).click()
    // 放弃修改后文件不变，与刚保存的内容一致
    expect((await readFile(file, 'utf8')).includes('新增内容')).toBe(true)
    // 保存后的磁盘内容作为后续比较基准（Muya 会规范化正文段落间距）
    const savedContent = await readFile(file, 'utf8')
    await page.getByRole('button', { name: '查看文章：编辑测试', exact: true }).click()
    await append(page, '冲突中的编辑')
    await writeFile(file, savedContent + '来自外部编辑器')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.editor-error')).toContainText('其他程序修改')
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await leave.getByRole('button', { name: '保存并继续', exact: true }).click()
    await expect(leave).not.toBeVisible()
    await expect(page.locator('.editor-error')).toContainText('其他程序修改')
    expect(await readFile(file, 'utf8')).toBe(savedContent + '来自外部编辑器')
    const copy = path.join(root, '编辑副本.md')
    await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }) }, copy)
    await page.getByRole('button', { name: '另存编辑副本', exact: true }).click()
    await expect(page.locator('.editor-footer')).toContainText('副本已写入')
    expect((await readFile(copy, 'utf8')).includes('冲突中的编辑')).toBe(true)
    // 重新加载磁盘版本，保留当前编辑写入恢复记录
    await page.getByRole('button', { name: '重新加载磁盘版本', exact: true }).click()
    await page.getByRole('button', { name: '保留编辑并加载', exact: true }).click()
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    // 重新打开文章时出现恢复记录提示
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('button', { name: '查看文章：编辑测试', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复到编辑器', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click()
    await page.waitForTimeout(500)
    await expect(page.locator('.editor-save-state')).toHaveText('未保存')
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    const restoredContent = await readFile(file, 'utf8')
    expect(restoredContent).toContain('冲突中的编辑')
    // 崩溃恢复：打开文章后窗口崩溃，重启后从恢复记录恢复
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    await page.getByRole('button', { name: '查看文章：编辑测试', exact: true }).click()
    await append(page, '崩溃前内容')
    // 等待 600ms 恢复记录检查点写入完成后再模拟崩溃
    await expect(page.locator('.editor-footer')).toContainText('恢复记录已更新')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy())
    await app.close()
    app = await electron.launch({ args: [path.resolve('.')], env }); page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: '查看文章：编辑测试', exact: true }).click()
    // 重启后出现恢复记录
    await expect(page.getByRole('button', { name: '恢复到编辑器', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click()
    await expect(page.locator('.editor-save-state')).toHaveText('未保存')
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.editor-save-state')).toHaveText('已保存')
    // 恢复后保存：包含崩溃前内容
    const finalContent = await readFile(file, 'utf8')
    expect(finalContent).toContain('崩溃前内容')
    await page.getByRole('button', { name: '返回列表', exact: true }).click()
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined)
    await app.close()
    if (path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(root).startsWith('astro-editor-e2e-')) await rm(root, { recursive: true, force: true })
  }
})
