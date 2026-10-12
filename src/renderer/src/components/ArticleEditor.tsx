import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, Code2, Columns2, Eye, FileDown, LoaderCircle, Redo2, RotateCcw, Save, Search, Undo2 } from 'lucide-react'
import type { ArticleDocument, DesktopApi, EditorBuffer, EditorRecovery, Result } from '../../../shared/contracts'
import { Button, cn } from './ui'
import { SourceEditor, type SourceEditorHandle } from './SourceEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { Modal } from './Modal'
import '../editor/editor.css'

export interface ArticleEditorHandle { save(): Promise<boolean>; discard(): Promise<boolean>; isDirty(): boolean; isBusy(): boolean }
interface Props {
  document: ArticleDocument; projectPath: string; api: DesktopApi;
  onSaved(document: ArticleDocument): void; onBack(): void;
  onDirtyChange(dirty: boolean): void; onRecoveryChange(): void;
}
async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code })
  return result.data
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export const ArticleEditor = forwardRef<ArticleEditorHandle, Props>(function ArticleEditor({ document, projectPath, api, onSaved, onBack, onDirtyChange, onRecoveryChange }, ref) {
  const cm = useRef<SourceEditorHandle>(null)
  const [source, setSource] = useState(document.source)
  const sourceRef = useRef(source)
  const base = useRef(document)
  const baseRevision = useRef(document.revision)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState<'source' | 'preview' | 'split'>('source')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [recovery, setRecovery] = useState<EditorRecovery | null>(null)
  const [loadingRecovery, setLoadingRecovery] = useState(true)
  const [reloadPrompt, setReloadPrompt] = useState(false)
  const [ratio, setRatio] = useState(50)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const suppressCheckpoint = useRef(false)
  const mounted = useRef(true)
  const target = { projectPath, relativePath: document.article.relativePath }
  const input = (): EditorBuffer => ({ ...target, source: sourceRef.current, baseRevision: baseRevision.current })
  const stopTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const reportDirty = (value: boolean) => { dirtyRef.current = value; setDirty(value); onDirtyChange(value) }

  useEffect(() => {
    mounted.current = true
    let disposed = false
    void unwrap(api.getEditorRecovery(target)).then(record => { if (!disposed) setRecovery(record && record.source !== document.source ? record : null) })
      .catch(cause => { if (!disposed) setError(message(cause)) }).finally(() => { if (!disposed) setLoadingRecovery(false) })
    return () => { disposed = true; mounted.current = false; stopTimer() }
  }, [])

  const change = (next: string) => {
    sourceRef.current = next
    setSource(next)
    const changed = next !== base.current.source
    reportDirty(changed)
    if (suppressCheckpoint.current) return
    setNotice('')
    stopTimer()
    timer.current = setTimeout(() => {
      pending.current = (changed ? unwrap(api.checkpointEditor(input())) : unwrap(api.clearEditorRecovery(target))).then(() => {
        if (mounted.current) { setNotice(changed ? '恢复记录已更新，文章尚未保存' : '与磁盘内容一致'); onRecoveryChange() }
      }).catch(cause => { if (mounted.current) setError(`恢复记录写入失败：${message(cause)}`) })
    }, 600)
  }
  const replace = (next: string) => {
    suppressCheckpoint.current = true
    cm.current?.replace(next)
    suppressCheckpoint.current = false
  }
  const save = async (): Promise<boolean> => {
    if (workingRef.current || loadingRecovery || recovery) return false
    if (!dirtyRef.current) return true
    workingRef.current = true; setWorking(true); stopTimer(); setError('')
    try {
      await pending.current
      const result = await unwrap(api.saveArticle(input()))
      base.current = result.document; baseRevision.current = result.document.revision
      reportDirty(false)
      setNotice(result.recoveryWarning ?? '已保存到本地文件')
      onSaved(result.document); onRecoveryChange()
      return true
    } catch (cause) { setError(message(cause)); onRecoveryChange(); return false }
    finally { workingRef.current = false; setWorking(false) }
  }
  const discard = async (): Promise<boolean> => {
    if (workingRef.current) return false
    workingRef.current = true; setWorking(true); stopTimer()
    try {
      await pending.current
      await unwrap(api.clearEditorRecovery(target))
      baseRevision.current = base.current.revision
      replace(base.current.source); reportDirty(false)
      setRecovery(null); setError(''); onRecoveryChange()
      return true
    } catch (cause) { setError(message(cause)); return false }
    finally { workingRef.current = false; setWorking(false) }
  }
  useImperativeHandle(ref, () => ({ save, discard, isDirty: () => dirtyRef.current, isBusy: () => workingRef.current }))

  const reload = async () => {
    workingRef.current = true; setWorking(true); stopTimer(); setError('')
    try {
      await pending.current
      if (dirtyRef.current) await unwrap(api.checkpointEditor(input()))
      const next = await unwrap(api.readArticle(target.relativePath))
      base.current = next; baseRevision.current = next.revision
      replace(next.source); reportDirty(false); onSaved(next)
      setNotice('已加载磁盘版本。之前的编辑保留在「恢复记录」中。')
      setRecovery(null); setReloadPrompt(false); onRecoveryChange()
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const exportCopy = async () => {
    workingRef.current = true; setWorking(true)
    try {
      const destination = await unwrap(api.exportEditorCopy({ source: sourceRef.current, suggestedName: `副本-${target.relativePath.split('/').at(-1)}` }))
      if (destination) setNotice(`副本已写入：${destination}。原文章尚未保存。`)
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const restoreRecovery = () => {
    if (!recovery) return
    baseRevision.current = recovery.baseRevision
    replace(recovery.source); setRecovery(null)
    setNotice('已恢复未保存内容，请检查后保存。')
  }

  return <section className="article-editor" aria-label="文章编辑工作区" onKeyDownCapture={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void save() } }}>
    <div className="editor-heading"><Button size="small" variant="ghost" onClick={onBack} disabled={working}><ArrowLeft size={16} />返回列表</Button><div className="editor-heading-title"><strong>{base.current.article.title}</strong><span>{target.relativePath}</span></div><span className={cn('editor-save-state', dirty && 'is-dirty')}>{dirty ? '未保存' : '已保存'}</span><Button variant="primary" size="small" disabled={!dirty || working || loadingRecovery || !!recovery} onClick={() => void save()}>{working ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存</Button></div>
    <div className="editor-toolbar"><div className="editor-modes" role="tablist" aria-label="编辑器视图">{([{ value: 'source', label: '源码', icon: Code2 }, { value: 'preview', label: '预览', icon: Eye }, { value: 'split', label: '左右分栏', icon: Columns2 }] as const).map(({ value, label, icon: Icon }) => <button key={value} role="tab" aria-selected={mode === value} onClick={() => setMode(value)}><Icon size={14} />{label}</button>)}</div><div className="editor-tools"><Button size="icon" variant="ghost" title="撤销" aria-label="撤销" disabled={working || !!recovery || loadingRecovery} onClick={() => cm.current?.undo()}><Undo2 size={15} /></Button><Button size="icon" variant="ghost" title="重做" aria-label="重做" disabled={working || !!recovery || loadingRecovery} onClick={() => cm.current?.redo()}><Redo2 size={15} /></Button><Button size="icon" variant="ghost" title="查找与替换" aria-label="查找与替换" onClick={() => { setMode(mode === 'preview' ? 'source' : mode); cm.current?.find() }}><Search size={15} /></Button><Button size="icon" variant="ghost" title="重新加载磁盘版本" aria-label="重新加载磁盘版本" disabled={working} onClick={() => dirty ? setReloadPrompt(true) : void reload()}><RotateCcw size={15} /></Button><Button size="icon" variant="ghost" title="另存编辑副本" aria-label="另存编辑副本" disabled={working} onClick={() => void exportCopy()}><FileDown size={15} /></Button></div></div>
    {error && <div className="editor-error" role="alert">{error}</div>}
    {recovery && <div className="recovery-prompt"><span>发现 {new Date(recovery.updatedAt).toLocaleString('zh-CN')} 的未保存内容。{recovery.baseRevision !== base.current.revision && '磁盘版本已变化，恢复后保存会先检查冲突。'}</span><Button size="small" onClick={restoreRecovery}>恢复到编辑器</Button><Button size="small" variant="ghost" onClick={() => void discard()}>放弃恢复记录</Button></div>}
    <div className={cn('editor-panes', `editor-mode-${mode}`)}>
      <div className="editor-source-pane" style={{ width: mode === 'split' ? `${ratio}%` : undefined }}><SourceEditor ref={cm} initialSource={document.source} disabled={working || loadingRecovery || !!recovery} onChange={change} onSave={() => void save()} onCursor={(line, column) => setCursor({ line, column })} /></div>
      {mode === 'split' && <div className="editor-divider" role="separator" aria-label="调整编辑器分栏" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={ratio} tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setRatio(value => Math.max(25, Math.min(75, value + (event.key === 'ArrowLeft' ? -5 : 5)))) } }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const rect = event.currentTarget.parentElement!.getBoundingClientRect(); setRatio(Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100))) } }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />}
      <div className="editor-preview-pane"><MarkdownPreview source={source} mdx={document.article.extension === '.mdx'} /></div>
    </div>
    <div className="editor-footer"><span role="status">{loadingRecovery ? '检查恢复记录…' : notice || (dirty ? '编辑中，Ctrl+S 保存' : '本地文件 · Ctrl+S 保存')}</span><span>行 {cursor.line}，列 {cursor.column}</span></div>
    {reloadPrompt && <Modal title="重新加载磁盘版本" onCancel={() => { if (!working) setReloadPrompt(false) }}><p>当前编辑会先写入恢复记录，再加载磁盘版本。之后可从恢复记录取回或导出副本。</p><div className="dialog-actions"><Button disabled={working} onClick={() => setReloadPrompt(false)}>取消</Button><Button disabled={working} variant="primary" onClick={() => void reload()}>保留编辑并加载</Button></div></Modal>}
  </section>
})
