import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { DesktopApi, ExternalEditorStatus, Result } from '../../../shared/contracts'
import { Button } from './ui'

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export function ExternalEditorSettings({ api }: { api: DesktopApi }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const report = (next: ExternalEditorStatus) => {
    if (next.associations['.md'] === 'ready' && next.associations['.mdx'] === 'ready') { setStatus(next.message); setError('') }
    else { setError(next.message); setStatus('') }
  }
  return <section className="settings-section" aria-label="外部编辑器"><div className="settings-section-title"><div><h2>外部编辑器</h2><p>使用 Windows 为该文件类型设置的默认程序打开，不需要在这里选择编辑器。</p></div></div>
    <p className="editor-config-note">.md 和 .mdx 分别使用各自的默认打开方式。未保存的编辑区不会被直接丢弃。打开成功后编辑区暂停，重新加载后才能继续修改；保存时若磁盘已变化会停止覆盖。</p>
    <div className="editor-config-actions"><Button size="small" disabled={busy} onClick={() => void (async () => {
      setBusy(true); setError(''); setStatus('')
      try { report(await unwrap(api.checkExternalEditor())) } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
    })()}>检查默认程序</Button></div>
    {error && <p className="settings-warning" role="alert"><AlertCircle size={15} />{error}</p>}
    {status && <p className="editor-config-status" role="status">{status}</p>}
  </section>
}
