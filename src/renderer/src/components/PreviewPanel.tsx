import { useEffect, useState } from 'react'
import { Check, Clipboard, ExternalLink, Globe, LoaderCircle, Square } from 'lucide-react'
import type { DesktopApi, PreviewPhase, PreviewState, Result } from '../../../shared/contracts'
import { Button } from './ui'
import { Modal } from './Modal'

const PHASE_LABEL: Record<PreviewPhase, string> = { idle: '未启动', checking: '检查中', starting: '启动中', running: '运行中', stopping: '停止中', failed: '失败' }
async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export function PreviewPanel({ api, onClose }: { api: DesktopApi; onClose(): void }) {
  const [state, setState] = useState<PreviewState | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => api.onPreviewState(setState), [api])
  useEffect(() => { void unwrap(api.getPreview()).then(setState).catch(cause => setError(cause instanceof Error ? cause.message : '无法读取预览状态。')) }, [api])
  const run = async (action: () => Promise<PreviewState | null>) => {
    setBusy(true); setError(''); setCopied(false)
    try { const next = await action(); if (next) setState(next) } catch (cause) { setError(cause instanceof Error ? cause.message : '预览操作失败。') }
    finally { setBusy(false) }
  }
  const phase = state?.phase ?? 'idle'
  const running = phase === 'checking' || phase === 'starting' || phase === 'running' || phase === 'stopping'
  return <Modal title="本地预览" onCancel={onClose}>
    <p>这里启动的是当前博客的 <code>npm run dev</code>，包含它自己的 predev。编辑器里的 Markdown 基础预览不会启动 Astro，也不会访问本地站点。</p>
    <p className="preview-status" role="status" data-preview-phase={phase}><strong>{PHASE_LABEL[phase]}</strong><span>{state?.message ?? '正在读取状态…'}</span></p>
    {state?.url && <p className="preview-url"><Globe size={14} />{state.url}</p>}
    {state?.runtime && <p className="preview-runtime">Node {state.runtime.nodeVersion} · npm {state.runtime.npmVersion} · {state.runtime.source === 'configured' ? '手动选择' : '自动检测'}</p>}
    {!!state?.checks.length && <div className="preview-checks">{state.checks.map(item => <div key={item.id} className={item.status === 'ok' ? 'preview-check is-ok' : 'preview-check'}><strong>{item.label}</strong><span>{item.detail}</span>{item.suggestion && <small>{item.suggestion}</small>}</div>)}</div>}
    <div className="dialog-actions">
      <Button variant="primary" disabled={busy || running} onClick={() => void run(() => unwrap(api.startPreview()))}>{phase === 'starting' || phase === 'checking' ? <LoaderCircle size={15} className="spin" /> : null}{phase === 'failed' ? '重新启动' : '启动本地预览'}</Button>
      <Button disabled={busy || (phase !== 'starting' && phase !== 'running')} onClick={() => void run(() => unwrap(api.stopPreview()))}><Square size={14} />停止预览</Button>
      <Button disabled={!state?.url || phase !== 'running'} onClick={() => void run(async () => { await unwrap(api.openPreviewHome()); return state })}><ExternalLink size={14} />在浏览器打开</Button>
      <Button disabled={!state?.log} onClick={() => void navigator.clipboard.writeText(state?.log ?? '').then(() => setCopied(true), () => setError('无法复制日志。'))}>{copied ? <Check size={14} /> : <Clipboard size={14} />}复制日志</Button>
    </div>
    <div className="dialog-actions">
      <Button disabled={busy || running} onClick={() => void run(() => unwrap(api.checkPreview()))}>检查环境</Button>
      <Button disabled={busy || running} onClick={() => void run(() => unwrap(api.choosePreviewRuntime()))}>选择 Node 和 npm</Button>
      <Button disabled={busy || running} onClick={() => void run(() => unwrap(api.clearPreviewRuntime()))}>恢复自动检测</Button>
    </div>
    {error && <p className="settings-warning" role="alert">{error}</p>}
    <pre className="preview-log" aria-label="预览日志">{state?.log || '还没有日志。'}</pre>
  </Modal>
}
