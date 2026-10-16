import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, CloudUpload, LoaderCircle } from 'lucide-react'
import type { DesktopApi, FileStatus, PushResult, Result, SyncSnapshot } from '../../../shared/contracts'
import { Badge, Button, type BadgeTone } from './ui'
import { Modal } from './Modal'

const statusLabels: Record<FileStatus, string> = { clean: '无改动', modified: '已修改', added: '已新增', deleted: '已删除', untracked: '未跟踪', conflict: '存在冲突', ignored: '已忽略', unknown: '状态未知' }
const statusTones: Partial<Record<FileStatus, BadgeTone>> = { conflict: 'warning', untracked: 'neutral', deleted: 'warning' }

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code })
  return result.data
}

const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

/**
 * 推送面板：打开时先拉取远程，再列出本次要提交的文件并要求填写提交信息，
 * 确认后执行 git add . → git commit → git push。冲突不在这个界面里解决。
 */
export function SyncDialog({ api, projectPath, onClose, onPushed }: { api: DesktopApi; projectPath: string; onClose(): void; onPushed(): void }) {
  const [phase, setPhase] = useState<'pulling' | 'ready' | 'pushing' | 'done' | 'failed'>('pulling')
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<PushResult | null>(null)

  const pull = useCallback(async () => {
    setPhase('pulling')
    setError('')
    try {
      setSnapshot(await unwrap(api.pullRemote({ projectPath })))
      setPhase('ready')
    } catch (cause) {
      setError(message(cause))
      setPhase('failed')
    }
  }, [api, projectPath])

  useEffect(() => { void pull() }, [pull])

  const changes = snapshot?.changes ?? []
  const hasWork = changes.length > 0 || (snapshot?.ahead ?? 0) > 0
  const canPush = phase === 'ready' && hasWork && (changes.length === 0 || commitMessage.trim().length > 0)
  const busy = phase === 'pulling' || phase === 'pushing'

  const push = async () => {
    setPhase('pushing')
    setError('')
    try {
      const pushed = await unwrap(api.pushChanges({ projectPath, message: commitMessage }))
      setResult(pushed)
      setPhase('done')
      onPushed()
    } catch (cause) {
      setError(message(cause))
      setPhase('failed')
    }
  }

  return <Modal title="推送本地修改" onCancel={() => { if (!busy) onClose() }}>
    {error && <p className="sync-error" role="alert"><AlertCircle size={15} /><span>{error}</span></p>}
    {phase === 'pulling' && <p className="sync-status"><LoaderCircle size={16} className="spin" />正在拉取远程仓库…</p>}
    {result && <p className="sync-done" role="status"><Check size={15} /><span>{result.message}</span></p>}

    {snapshot && phase !== 'failed' && <>
      <p className="sync-context">分支 <code>{snapshot.branch ?? '未知'}</code>，远程 <code>{snapshot.remote ?? '未配置'}</code>，领先 {snapshot.ahead} / 落后 {snapshot.behind} 个提交。</p>
      {(!snapshot.identity.name || !snapshot.identity.email) && <p className="sync-warning" role="alert"><AlertCircle size={15} /><span>仓库没有配置提交身份（user.name / user.email），提交会被 Git 拒绝。请先配置好再推送。</span></p>}
      <div className="sync-changes">
        <div className="sync-changes-head"><span>本次提交的文件</span><Badge>{changes.length} 个</Badge></div>
        {changes.length === 0
          ? <p className="muted">{snapshot.ahead > 0 ? '工作区没有改动，只会推送已经提交的本地提交。' : '本地没有需要提交或推送的修改。'}</p>
          : <ul className="sync-list">{changes.map(change => <li key={change.path}><Badge tone={statusTones[change.status] ?? 'accent'}>{statusLabels[change.status]}</Badge><span title={change.path}>{change.path}</span></li>)}</ul>}
      </div>
      <label className="sync-message"><span>提交信息</span><input className="input" value={commitMessage} maxLength={200} autoFocus placeholder="例如：更新文章与配图" disabled={busy} onChange={event => setCommitMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && canPush) void push() }} /></label>
      <p className="sync-note">推送会依次执行 git add . → git commit → git push，提交范围是仓库里的全部改动。不强制推送，也不提交已经存在的合并冲突。</p>
    </>}

    <div className="dialog-actions">
      {phase === 'failed' && <Button disabled={busy} onClick={() => void pull()}>重新拉取</Button>}
      <Button disabled={busy} onClick={onClose}>{phase === 'done' ? '关闭' : '取消'}</Button>
      {phase !== 'done' && <Button variant="primary" disabled={!canPush} onClick={() => void push()}>{phase === 'pushing' ? <><LoaderCircle size={15} className="spin" />正在推送…</> : <><CloudUpload size={15} />确认推送</>}</Button>}
    </div>
  </Modal>
}
