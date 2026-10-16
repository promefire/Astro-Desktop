import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/contracts'
import type { DesktopApi, PreviewState } from '../shared/contracts'

// Expose only named, typed operations, never ipcRenderer or a general invoke method.
const api: DesktopApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setTheme: (theme) => ipcRenderer.invoke(IPC.setTheme, theme),
  setMarkdownHtml: (enabled) => ipcRenderer.invoke(IPC.setMarkdownHtml, enabled),
  forgetProject: (path) => ipcRenderer.invoke(IPC.forgetProject, path),
  selectProject: () => ipcRenderer.invoke(IPC.selectProject),
  openRecentProject: (path) => ipcRenderer.invoke(IPC.openRecentProject, path),
  getProject: () => ipcRenderer.invoke(IPC.getProject),
  refreshProject: () => ipcRenderer.invoke(IPC.refreshProject),
  listArticles: () => ipcRenderer.invoke(IPC.listArticles),
  readArticle: (path) => ipcRenderer.invoke(IPC.readArticle, path),
  createDraft: (input) => ipcRenderer.invoke(IPC.createDraft, input),
  deleteArticle: (input) => ipcRenderer.invoke(IPC.deleteArticle, input),
  importImage: (input) => ipcRenderer.invoke(IPC.importImage, input),
  importRemoteImage: (input) => ipcRenderer.invoke(IPC.importRemoteImage, input),
  chooseArticleImage: (input) => ipcRenderer.invoke(IPC.chooseArticleImage, input),
  readPreviewImage: (input) => ipcRenderer.invoke(IPC.readPreviewImage, input),
  publishDraft: (input) => ipcRenderer.invoke(IPC.publishDraft, input),
  withdrawPost: (input) => ipcRenderer.invoke(IPC.withdrawPost, input),
  getImageStorage: () => ipcRenderer.invoke(IPC.getImageStorage),
  setImageStorage: (input) => ipcRenderer.invoke(IPC.setImageStorage, input),
  onContentChanged: (listener) => {
    const callback = () => listener()
    ipcRenderer.on(IPC.contentChanged, callback)
    return () => { ipcRenderer.removeListener(IPC.contentChanged, callback) }
  },
  saveArticle: (input) => ipcRenderer.invoke(IPC.saveArticle, input),
  checkpointEditor: (input) => ipcRenderer.invoke(IPC.checkpointEditor, input),
  getEditorRecovery: (input) => ipcRenderer.invoke(IPC.getEditorRecovery, input),
  clearEditorRecovery: (input) => ipcRenderer.invoke(IPC.clearEditorRecovery, input),
  listEditorRecoveries: () => ipcRenderer.invoke(IPC.listEditorRecoveries),
  exportEditorCopy: (input) => ipcRenderer.invoke(IPC.exportEditorCopy, input),
  checkExternalEditor: () => ipcRenderer.invoke(IPC.checkExternalEditor),
  openExternalEditor: (input) => ipcRenderer.invoke(IPC.openExternalEditor, input),
  getPreview: () => ipcRenderer.invoke(IPC.getPreview),
  checkPreview: () => ipcRenderer.invoke(IPC.checkPreview),
  startPreview: () => ipcRenderer.invoke(IPC.startPreview),
  stopPreview: () => ipcRenderer.invoke(IPC.stopPreview),
  choosePreviewRuntime: () => ipcRenderer.invoke(IPC.choosePreviewRuntime),
  clearPreviewRuntime: () => ipcRenderer.invoke(IPC.clearPreviewRuntime),
  openPreviewHome: () => ipcRenderer.invoke(IPC.openPreviewHome),
  openPreviewArticle: (input) => ipcRenderer.invoke(IPC.openPreviewArticle, input),
  onPreviewState: (listener) => {
    const callback = (_event: unknown, snapshot: PreviewState) => listener(snapshot)
    ipcRenderer.on(IPC.previewState, callback)
    return () => { ipcRenderer.removeListener(IPC.previewState, callback) }
  },
  setEditorDirty: (dirty) => ipcRenderer.send(IPC.setEditorDirty, dirty),
  onCloseRequested: (listener) => { const callback = () => listener(); ipcRenderer.on(IPC.closeRequested, callback); return () => { ipcRenderer.removeListener(IPC.closeRequested, callback) } },
  closeWindow: () => ipcRenderer.invoke(IPC.closeWindow),
  revealArticle: (path) => ipcRenderer.invoke(IPC.revealArticle, path),
  openProjectFolder: () => ipcRenderer.invoke(IPC.openProjectFolder),
}
contextBridge.exposeInMainWorld('astroDesktop', Object.freeze(api))
