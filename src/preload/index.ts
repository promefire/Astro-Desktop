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
  revealArticle: (path) => ipcRenderer.invoke(IPC.revealArticle, path),
  openProjectFolder: () => ipcRenderer.invoke(IPC.openProjectFolder),
}
contextBridge.exposeInMainWorld('astroDesktop', Object.freeze(api))
