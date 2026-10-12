import { useState } from 'react'
import type { DesktopApi, EditorRecovery, RecoveryIndex } from '../../../shared/contracts'
import { Button } from './ui'
import { Modal } from './Modal'

export function RecoveriesDialog({ api, index, onClose, onOpen, onChanged }: { api: DesktopApi; index: RecoveryIndex; onClose(): void; onOpen(path: string): void; onChanged(): void }) {
  const [record, setRecord] = useState<EditorRecovery | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [notice, setNotice] = useState('')
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败。') } finally { setBusy(false) } }
  return <Modal title="未保存内容的恢复记录" onCancel={() => { if (!busy) onClose() }}>
    <p>恢复记录保存在客户端本地。可以打开原文章继续编辑，也可以导出副本，即使原文件已被移走。</p>
    <ul className="recovery-list">{index.entries.map(entry => <li key={entry.relativePath}><button disabled={busy} onClick={() => void run(async () => {
      const result = await api.getEditorRecovery(entry)
      if (!result.ok) throw new Error(result.error)
      setRecord(result.data); setConfirmDiscard(false); setNotice('')
    })}>{entry.relativePath}<small>{new Date(entry.updatedAt).toLocaleString('zh-CN')}</small></button></li>)}</ul>
    {index.issues.map(issue => <p className="editor-error" key={issue}>{issue}</p>)}
    {record && <><textarea className="recovery-source" aria-label="恢复记录源码" value={record.source} readOnly /><div className="dialog-actions"><Button disabled={busy} onClick={() => { onClose(); onOpen(record.relativePath) }}>打开原文章</Button><Button disabled={busy} onClick={() => void run(async () => {
      const result = await api.exportEditorCopy({ source: record.source, suggestedName: `恢复-${record.relativePath.split('/').at(-1)}` })
      if (!result.ok) throw new Error(result.error)
      if (result.data) setNotice(`恢复副本已写入：${result.data}`)
    })}>导出恢复副本</Button><Button disabled={busy} onClick={() => { if (!confirmDiscard) { setConfirmDiscard(true); return } void run(async () => { const result = await api.clearEditorRecovery(record); if (!result.ok) throw new Error(result.error); setRecord(null); onChanged() }) }}>{confirmDiscard ? '确认放弃这条记录' : '放弃此恢复记录'}</Button></div></>}
    {error && <p role="alert" className="editor-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="dialog-actions"><Button disabled={busy} onClick={onClose}>关闭</Button></div>
  </Modal>
}
