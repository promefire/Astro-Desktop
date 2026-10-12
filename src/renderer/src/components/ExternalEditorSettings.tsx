import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { AppSettings, DesktopApi, ExternalEditorStatus, Result } from '../../../shared/contracts'
import { Button } from './ui'

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export function ExternalEditorSettings({ api, settings, onSettings }: { api: DesktopApi; settings: AppSettings; onSettings: (settings: AppSettings) => void }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const report = (next: ExternalEditorStatus) => {
    if (next.state === 'ready' || next.state === 'unconfigured') { setStatus(next.message); setError('') }
    else { setError(next.message); setStatus('') }
  }
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setStatus('')
    try { await action() } catch (cause) { setError(message(cause)); setStatus('') } finally { setBusy(false) }
  }
  return <section className="settings-section" aria-label="外部编辑器"><div className="settings-section-title"><div><h2>外部编辑器</h2><p>用本机程序打开当前文章。文件路径作为单独参数传递，不经过命令行拼接。</p></div></div>
    <p className="editor-config-path">{settings.externalEditorPath ? <code>{settings.externalEditorPath}</code> : '尚未配置'}</p>
    <p className="editor-config-note">建议选择编辑器的 .exe，例如 VS Code 的 Code.exe。也可以选择 .cmd / .bat；路径中的空格和中文会保留，但不能包含 %。未保存的编辑区不会被直接丢弃。外部修改后需要重新加载，保存时若磁盘已变化会停止覆盖。</p>
    <div className="editor-config-actions"><Button size="small" disabled={busy} onClick={() => void run(async () => {
      const next = await unwrap(api.selectExternalEditor())
      if (!next) { setStatus('未更改外部编辑器。'); return }
      onSettings(next)
      setStatus(next.externalEditorPath ? `已保存外部编辑器：${next.externalEditorPath}` : '未更改外部编辑器。')
    })}>选择编辑器</Button><Button size="small" disabled={busy} onClick={() => void run(async () => report(await unwrap(api.checkExternalEditor())))}>检查编辑器</Button><Button size="small" variant="ghost" disabled={busy || !settings.externalEditorPath} onClick={() => void run(async () => { onSettings(await unwrap(api.setExternalEditor(null))); setStatus('已清除外部编辑器配置。') })}>清除配置</Button></div>
    {error && <p className="settings-warning" role="alert"><AlertCircle size={15} />{error}</p>}
    {status && <p className="editor-config-status" role="status">{status}</p>}
  </section>
}
