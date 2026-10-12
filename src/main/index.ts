import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { resolve, dirname, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'
import { IPC } from '../shared/contracts'
import type { Result, Theme } from '../shared/contracts'
import { createServices, ServiceError } from './services'
import { exportInput, writeEditorCopy } from './services/export-copy'

const runtimeDir = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
// Test sessions use a separate profile; packaged builds always use the normal userData directory.
if (!app.isPackaged && process.env.ASTRO_DESKTOP_USER_DATA) {
  app.setPath('userData', resolve(process.env.ASTRO_DESKTOP_USER_DATA))
}
app.setName('Astro Desktop')
protocol.registerSchemesAsPrivileged([{ scheme: 'astro-desktop', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

let mainWindow: BrowserWindow | null = null
let editorDirty = false
const productionUrl = 'astro-desktop://app/index.html'
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
if (devUrl && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(devUrl)) {
  throw new Error('开发页面必须来自本机 Vite 服务。')
}
const rendererUrl = devUrl ? new URL(devUrl).href : productionUrl

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('拒绝非主窗口请求。')
  }
  const actual = new URL(event.senderFrame.url)
  const expected = new URL(rendererUrl)
  if (actual.protocol !== expected.protocol || actual.host !== expected.host || actual.pathname !== expected.pathname) {
    throw new Error('拒绝来自未知页面的请求。')
  }
}

function stringArgument(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 32768 || value.includes('\0')) throw new Error('无效的路径参数。')
  return value
}

function registerHandlers(): void {
  const services = createServices(join(app.getPath('userData'), 'settings.json'))
  const handle = (channel: string, action: (...args: unknown[]) => Promise<unknown>) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      try {
        assertTrustedSender(event)
        return { ok: true, data: await action(...args) }
      } catch (error) {
        // Only explicit service messages reach the UI. No command output or environment is logged.
        const message = error instanceof Error ? error.message : '操作失败，请重试。'
        return { ok: false, error: message, code: error instanceof ServiceError ? error.code : 'OPERATION_FAILED' }
      }
    })
  }
  handle(IPC.getSettings, () => services.settings.get())
  handle(IPC.setTheme, async (theme) => {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system') throw new Error('无效的外观设置。')
    return services.settings.setTheme(theme as Theme)
  })
  handle(IPC.forgetProject, (path) => services.settings.forgetProject(stringArgument(path)))
  handle(IPC.selectProject, async () => {
    if (!mainWindow) throw new Error('主窗口不可用。')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Astro 博客项目目录', buttonLabel: '打开博客', properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return services.projects.select(result.filePaths[0])
  })
  handle(IPC.openRecentProject, (path) => services.projects.openRecent(stringArgument(path)))
  handle(IPC.getProject, async () => services.projects.getCurrent())
  handle(IPC.refreshProject, () => services.projects.refresh())
  handle(IPC.listArticles, () => services.content.list())
  handle(IPC.readArticle, (path) => services.content.read(stringArgument(path)))
  handle(IPC.createDraft, (input) => services.content.createDraft(input))
  handle(IPC.saveArticle, (input) => services.content.save(input))
  handle(IPC.checkpointEditor, (input) => services.editor.checkpoint(input))
  handle(IPC.getEditorRecovery, (input) => services.editor.getRecovery(input))
  handle(IPC.clearEditorRecovery, (input) => services.editor.clearRecovery(input))
  handle(IPC.listEditorRecoveries, () => services.editor.listRecoveries())
  handle(IPC.setExternalEditor, (value) => {
    if (value !== null && typeof value !== 'string') throw new ServiceError('EDITOR_INVALID', '外部编辑器路径无效。')
    return services.settings.setExternalEditor(value === null ? null : stringArgument(value))
  })
  handle(IPC.checkExternalEditor, () => services.settings.checkExternalEditor())
  handle(IPC.selectExternalEditor, async () => {
    if (!mainWindow) throw new Error('主窗口不可用。')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择外部编辑器', buttonLabel: '使用此编辑器', properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return services.settings.setExternalEditor(result.filePaths[0])
  })
  handle(IPC.openExternalEditor, (input) => services.externalEditor.open(input))
  handle(IPC.exportEditorCopy, async value => {
    const input = exportInput(value)
    if (!mainWindow) throw new Error('主窗口不可用。')
    const result = await dialog.showSaveDialog(mainWindow, { title: '另存编辑副本', defaultPath: join(app.getPath('documents'), input.suggestedName), filters: [{ name: 'Markdown', extensions: ['md', 'mdx'] }] })
    if (result.canceled || !result.filePath) return null
    await writeEditorCopy(result.filePath, input.source)
    return result.filePath
  })
  ipcMain.on(IPC.setEditorDirty, (event, dirty: unknown) => {
    try { assertTrustedSender(event); if (typeof dirty === 'boolean') editorDirty = dirty } catch { /* Reject untrusted senders. */ }
  })
  handle(IPC.closeWindow, async () => { mainWindow?.close() })
  handle(IPC.revealArticle, async (path) => {
    const absolutePath = await services.content.resolveArticlePath(stringArgument(path))
    shell.showItemInFolder(absolutePath)
  })
  handle(IPC.openProjectFolder, async () => {
    const project = await services.projects.refresh()
    const error = await shell.openPath(project.path)
    if (error) throw new Error('无法打开项目文件夹，请检查目录是否仍然存在。')
  })
}

async function registerAppProtocol(): Promise<void> {
  const rendererRoot = await realpath(resolve(runtimeDir, '../renderer'))
  protocol.handle('astro-desktop', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 })
      const pathname = decodeURIComponent(url.pathname)
      if (pathname.includes('\\') || pathname.includes('\0')) return new Response('Forbidden', { status: 403 })
      const target = await realpath(resolve(rendererRoot, `.${pathname}`))
      const inside = relative(rendererRoot, target)
      if (inside.startsWith('..') || isAbsolute(inside)) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 680,
    title: 'Astro Desktop', backgroundColor: '#f7f7fa', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(runtimeDir, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== rendererUrl.split('#')[0]) event.preventDefault()
  })
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', event => { if (editorDirty) { event.preventDefault(); mainWindow?.webContents.send(IPC.closeRequested) } })
  mainWindow.on('closed', () => { mainWindow = null; editorDirty = false })
  try {
    await mainWindow.loadURL(rendererUrl)
  } catch (error) {
    // Vite may replace the initial navigation after dependency optimization.
    // Its replacement navigation owns the load; do not close the window under it.
    if (devUrl && error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED') return
    throw error
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  if (!devUrl) await registerAppProtocol()
  registerHandlers()
  await createWindow()
  app.on('activate', () => { if (!mainWindow) void createWindow() })
}).catch((error: unknown) => {
  console.error('Astro Desktop startup failed:', error instanceof Error ? error.message : 'Unknown startup error')
  dialog.showErrorBox('Astro Desktop 启动失败', error instanceof Error ? error.message : '未知错误')
  app.quit()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
