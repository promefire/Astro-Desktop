import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/contracts'
import type { DesktopApi } from '../shared/contracts'

// Expose only named, typed operations, never ipcRenderer or a general invoke method.
const api: DesktopApi = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setTheme: (theme) => ipcRenderer.invoke(IPC.setTheme, theme),
  forgetProject: (path) => ipcRenderer.invoke(IPC.forgetProject, path),
  selectProject: () => ipcRenderer.invoke(IPC.selectProject),
  openRecentProject: (path) => ipcRenderer.invoke(IPC.openRecentProject, path),
  getProject: () => ipcRenderer.invoke(IPC.getProject),
  refreshProject: () => ipcRenderer.invoke(IPC.refreshProject),
  listArticles: () => ipcRenderer.invoke(IPC.listArticles),
  readArticle: (path) => ipcRenderer.invoke(IPC.readArticle, path),
  createDraft: (input) => ipcRenderer.invoke(IPC.createDraft, input),
  saveArticle: (input) => ipcRenderer.invoke(IPC.saveArticle, input),
  checkpointEditor: (input) => ipcRenderer.invoke(IPC.checkpointEditor, input),
  getEditorRecovery: (input) => ipcRenderer.invoke(IPC.getEditorRecovery, input),
  clearEditorRecovery: (input) => ipcRenderer.invoke(IPC.clearEditorRecovery, input),
  listEditorRecoveries: () => ipcRenderer.invoke(IPC.listEditorRecoveries),
  exportEditorCopy: (input) => ipcRenderer.invoke(IPC.exportEditorCopy, input),
  checkExternalEditor: () => ipcRenderer.invoke(IPC.checkExternalEditor),
  openExternalEditor: (input) => ipcRenderer.invoke(IPC.openExternalEditor, input),
  setEditorDirty: (dirty) => ipcRenderer.send(IPC.setEditorDirty, dirty),
  onCloseRequested: (listener) => { const callback = () => listener(); ipcRenderer.on(IPC.closeRequested, callback); return () => { ipcRenderer.removeListener(IPC.closeRequested, callback) } },
  closeWindow: () => ipcRenderer.invoke(IPC.closeWindow),
  revealArticle: (path) => ipcRenderer.invoke(IPC.revealArticle, path),
  openProjectFolder: () => ipcRenderer.invoke(IPC.openProjectFolder),
}
contextBridge.exposeInMainWorld('astroDesktop', Object.freeze(api))
