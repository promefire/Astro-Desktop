import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, Code2, Download, ExternalLink, FileDown, Globe, ImagePlus, LoaderCircle, PenLine, Redo2, RotateCcw, Save, Send, Undo2 } from 'lucide-react'
import type { ArticleDocument, DesktopApi, EditorBuffer, EditorRecovery, PreviewArticleResult, Result } from '../../../shared/contracts'
import { Button, cn } from './ui'
import { MuyaEditor, type MuyaEditorHandle } from './MuyaEditor'
import { SourceEditor, type SourceEditorHandle } from './SourceEditor'
import { Modal } from './Modal'
import { imageUrlKey, markdownImages, replaceMarkdownImages } from '../../../shared/markdown-images'
import { sameMarkdown, splitMarkdownSource } from '../editor/source-state'
import '../editor/editor.css'

export interface ArticleEditorHandle { save(): Promise<boolean>; discard(): Promise<boolean>; isDirty(): boolean; isBusy(): boolean }
interface Props {
  document: ArticleDocument; projectPath: string; api: DesktopApi;
  onSaved(document: ArticleDocument): void; onPublished(document: ArticleDocument): void; onBack(): void;
  onDirtyChange(dirty: boolean): void; onRecoveryChange(): void;
}
async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code })
  return result.data
}

const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

type EditorMode = 'wysiwyg' | 'source'

export const ArticleEditor = forwardRef<ArticleEditorHandle, Props>(function ArticleEditor({
  document, projectPath, api, onSaved, onPublished, onBack, onDirtyChange, onRecoveryChange
}, ref) {
  const muya = useRef<MuyaEditorHandle>(null)
  const sourceEditor = useRef<SourceEditorHandle>(null)
  const isMdx = document.article.extension === '.mdx'
  const initialParts = splitMarkdownSource(document.source)
  const initialMode: EditorMode = isMdx ? 'source' : 'wysiwyg'
  const [mode, setMode] = useState<EditorMode>(initialMode)
  const modeRef = useRef(initialMode)
  const [body, setBody] = useState(initialParts.body)
  const bodyRef = useRef(initialParts.body)
  const base = useRef({ ...document, body: initialParts.body })
  const frontmatterRef = useRef(initialParts.frontmatter)
  const baseRevision = useRef(document.revision)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [working, setWorking] = useState(false)
  const workingRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [imageProgress, setImageProgress] = useState('')
  const imageProgressRef = useRef('')
  const [switching, setSwitching] = useState(false)
  const switchingRef = useRef(false)
  const [stoppingImages, setStoppingImages] = useState(false)
  const stopImages = useRef(false)
  const [recovery, setRecovery] = useState<EditorRecovery | null>(null)
  const [loadingRecovery, setLoadingRecovery] = useState(true)
  const [reloadPrompt, setReloadPrompt] = useState(false)
  const [externalPrompt, setExternalPrompt] = useState<null | 'dirty' | 'stale'>(null)
  const [externalSession, setExternalSession] = useState(false)
  const [sitePrompt, setSitePrompt] = useState(false)
  const [publishPrompt, setPublishPrompt] = useState(false)
  const [siteUnresolved, setSiteUnresolved] = useState<PreviewArticleResult | null>(null)
  const externalSessionRef = useRef(false)
  const setExternal = (value: boolean) => { externalSessionRef.current = value; setExternalSession(value) }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Promise<unknown>>(Promise.resolve())
  const mounted = useRef(true)
  const target = { projectPath, relativePath: document.article.relativePath }
  const input = (): EditorBuffer => ({ ...target, source: frontmatterRef.current + bodyRef.current, baseRevision: baseRevision.current })
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
    if (externalSessionRef.current || next === bodyRef.current) return
    bodyRef.current = next
    setBody(next)
    const changed = !sameMarkdown(next, base.current.body)
    reportDirty(changed)
    setNotice('')
    stopTimer()
    timer.current = setTimeout(() => {
      pending.current = (changed ? unwrap(api.checkpointEditor(input())) : unwrap(api.clearEditorRecovery(target))).then(() => {
        if (mounted.current) setNotice(current => current.startsWith('已') ? current : changed ? '恢复记录已更新，文章尚未保存' : '与磁盘内容一致'); if (mounted.current) onRecoveryChange()
      }).catch(cause => { if (mounted.current) setError(`恢复记录写入失败:${message(cause)}`) })
    }, 600)
  }
  const rememberBody = (next: string) => {
    if (!isMdx) muya.current?.replace(next)
    sourceEditor.current?.replace(next)
    bodyRef.current = next
    setBody(next)
  }
  const modeLocked = () => workingRef.current || loadingRecovery || !!recovery || externalSessionRef.current || switchingRef.current || imageProgressRef.current !== ''
  const showMode = (next: EditorMode, focusEditor: boolean) => {
    if (isMdx || next === modeRef.current || modeLocked()) return
    switchingRef.current = true
    setSwitching(true)
    // Muya applies typed text on the next frame. Read after that frame so the switch sees it.
    requestAnimationFrame(() => {
      if (!mounted.current) return
      const live = (modeRef.current === 'source' ? sourceEditor.current?.getMarkdown() : muya.current?.getMarkdown()) ?? bodyRef.current
      const buffer = bodyRef.current
      const chosen = live === buffer || !sameMarkdown(live, base.current.body) ? live : buffer
      const adopted = next === 'wysiwyg' ? (muya.current?.replace(chosen) ?? chosen) : chosen
      if (next === 'source' || adopted !== chosen) sourceEditor.current?.replace(adopted)
      if (adopted !== bodyRef.current) change(adopted)
      modeRef.current = next
      setMode(next)
      requestAnimationFrame(() => {
        if (!mounted.current) return
        switchingRef.current = false
        setSwitching(false)
        if (focusEditor) {
          if (modeRef.current === 'source') sourceEditor.current?.focus()
          else muya.current?.focus()
        } else window.document.getElementById(next === 'source' ? 'editor-tab-source' : 'editor-tab-wysiwyg')?.focus()
      })
    })
  }
  const save = async (): Promise<boolean> => {
    if (workingRef.current || loadingRecovery || recovery || externalSessionRef.current) return false
    if (!dirtyRef.current) return true
    workingRef.current = true; setWorking(true); stopTimer(); setError('')
    try {
      await pending.current
      const result = await unwrap(api.saveArticle(input()))
      const parts = splitMarkdownSource(result.document.source)
      base.current = { ...result.document, body: parts.body }; frontmatterRef.current = parts.frontmatter
      baseRevision.current = result.document.revision
      rememberBody(parts.body)
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
      rememberBody(splitMarkdownSource(base.current.source).body); reportDirty(false)
      setRecovery(null); setError(''); onRecoveryChange()
      return true
    } catch (cause) { setError(message(cause)); return false }
    finally { workingRef.current = false; setWorking(false) }
  }
  useImperativeHandle(ref, () => ({ save, discard, isDirty: () => dirtyRef.current, isBusy: () => workingRef.current }))

  const reload = async (): Promise<boolean> => {
    workingRef.current = true; setWorking(true); stopTimer(); setError('')
    try {
      await pending.current
      const hadEdits = dirtyRef.current
      if (hadEdits) await unwrap(api.checkpointEditor(input()))
      const next = await unwrap(api.readArticle(target.relativePath))
      const parts = splitMarkdownSource(next.source)
      base.current = { ...next, body: parts.body }; frontmatterRef.current = parts.frontmatter; baseRevision.current = next.revision
      rememberBody(parts.body); reportDirty(false); onSaved(next)
      setNotice(hadEdits ? '已加载磁盘版本。之前的编辑保留在「恢复记录」中。' : '已加载磁盘版本。')
      setRecovery(null); setReloadPrompt(false); onRecoveryChange()
      return true
    } catch (cause) { setError(message(cause)); return false }
    finally { workingRef.current = false; setWorking(false) }
  }
  const exportCopy = async () => {
    workingRef.current = true; setWorking(true)
    try {
      const destination = await unwrap(api.exportEditorCopy({ source: frontmatterRef.current + bodyRef.current, suggestedName: `副本-${target.relativePath.split('/').at(-1)}` }))
      if (destination) setNotice('副本已写入:' + destination + '。原文章尚未保存。')
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const launchExternal = async () => {
    await unwrap(api.openExternalEditor(target))
    setExternalPrompt(null)
    setNotice('')
    setExternal(true)
  }
  const finishExternal = async () => {
    const loaded = await reload()
    if (loaded) setExternal(false)
  }
  const requestExternal = async () => {
    if (workingRef.current || loadingRecovery || recovery || externalSessionRef.current) return
    workingRef.current = true; setWorking(true); setError(''); setNotice('')
    try {
      const status = await unwrap(api.checkExternalEditor())
      if (status.associations[document.article.extension] !== 'ready') {
        setError('no default for ' + document.article.extension)
        return
      }
      if (dirtyRef.current) { setExternalPrompt('dirty'); return }
      const disk = await unwrap(api.readArticle(target.relativePath))
      if (disk.revision !== baseRevision.current) { setExternalPrompt('stale'); return }
      await launchExternal()
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const saveAndOpen = async () => {
    const saved = await save()
    if (!saved) { setExternalPrompt(null); return }
    workingRef.current = true; setWorking(true); setError('')
    try { await launchExternal() } catch (cause) { setError(message(cause)); setExternalPrompt(null) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const discardAndOpen = async () => {
    const discarded = await discard()
    if (!discarded) return
    workingRef.current = true; setWorking(true); setError('')
    try {
      const disk = await unwrap(api.readArticle(target.relativePath))
      if (disk.revision !== baseRevision.current) { setExternalPrompt('stale'); return }
      await launchExternal()
    } catch (cause) { setError(message(cause)); setExternalPrompt(null) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const reloadAndOpen = async () => {
    const loaded = await reload()
    if (!loaded) { setExternalPrompt(null); return }
    workingRef.current = true; setWorking(true); setError('')
    try { await launchExternal() } catch (cause) { setError(message(cause)); setExternalPrompt(null) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const openSiteArticle = async (notice: string) => {
    const result = await unwrap(api.openPreviewArticle(target))
    if (result.kind === 'opened') setNotice(notice)
    else setSiteUnresolved(result)
  }
  const requestSitePreview = async () => {
    if (workingRef.current || loadingRecovery || recovery || externalSessionRef.current) return
    setError(''); setNotice('')
    if (dirtyRef.current) { setSitePrompt(true); return }
    workingRef.current = true; setWorking(true)
    try { await openSiteArticle('已在系统浏览器打开站点中的这篇文章。打开的是磁盘内容。') }
    catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const saveAndPreview = async () => {
    const saved = await save()
    if (!saved) { setSitePrompt(false); return }
    workingRef.current = true; setWorking(true); setError('')
    try { await openSiteArticle('已保存，并在系统浏览器打开磁盘上的文章。'); setSitePrompt(false) }
    catch (cause) { setError(message(cause)); setSitePrompt(false) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const discardAndPreview = async () => {
    const discarded = await discard()
    if (!discarded) return
    workingRef.current = true; setWorking(true); setError('')
    try { await openSiteArticle('已放弃编辑区修改，并打开磁盘上的文章。'); setSitePrompt(false) }
    catch (cause) { setError(message(cause)); setSitePrompt(false) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const runPublish = async () => {
    if (workingRef.current || loadingRecovery || recovery || externalSessionRef.current) return
    workingRef.current = true; setWorking(true); setError(''); setPublishPrompt(false)
    try {
      const result = await unwrap(api.publishDraft({ ...target, baseRevision: baseRevision.current }))
      setNotice(result.message)
      onPublished(result.document)
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const saveAndPublish = async () => {
    const saved = await save()
    if (!saved) { setPublishPrompt(false); return }
    await runPublish()
  }
  const discardAndPublish = async () => {
    const discarded = await discard()
    if (!discarded) return
    await runPublish()
  }
  const restoreRecovery = () => {
    if (!recovery) return
    baseRevision.current = base.current.revision
    const recoveredBody = recovery.source.startsWith(frontmatterRef.current) ? recovery.source.slice(frontmatterRef.current.length) : recovery.source
    if (!isMdx) muya.current?.replace(recoveredBody)
    sourceEditor.current?.replace(recoveredBody)
    setRecovery(null)
    if (recoveredBody !== bodyRef.current) change(recoveredBody)
    setNotice('已恢复未保存内容，请检查后保存。')
  }
  const imageBlocked = () => workingRef.current || loadingRecovery || !!recovery || externalSessionRef.current || switchingRef.current || document.article.kind === 'ai-daily'
  const activeEditor = () => modeRef.current === 'source' ? sourceEditor.current : muya.current
  const pasteMarkdown = (text: string): boolean => {
    if (imageBlocked() || text.length > 2 * 1024 * 1024) return false
    const images = markdownImages(text)
    if (!images.length) return false
    const applied = activeEditor()?.insert(text)
    if (!applied) return true
    workingRef.current = true; setWorking(true); setError(''); setNotice('')
    stopImages.current = false; setStoppingImages(false)
    const urls = [...new Set(images.map(image => imageUrlKey(image.url)))]
    const destinations = new Map<string, string>()
    void (async () => {
      const failures: string[] = []
      let done = 0, skipped = 0, attempted = 0
      try {
        for (const [index, url] of urls.slice(0, 20).entries()) {
          if (stopImages.current || !mounted.current) break
          attempted++
          imageProgressRef.current = 'progress ' + index + '/' + Math.min(urls.length, 20)
          setImageProgress(imageProgressRef.current)
          try {
            const result = await unwrap(api.importRemoteImage({ ...target, url }))
            if (!mounted.current) break
            if (result.skipped) { skipped++; continue }
            destinations.set(url, result.destination)
            done++
          } catch (cause) { failures.push('item ' + (index + 1) + ': ' + message(cause)) }
        }
        if (!mounted.current) return
        if (destinations.size) {
          const current = (modeRef.current === 'source' ? sourceEditor.current?.getMarkdown() : muya.current?.getMarkdown()) ?? bodyRef.current
          const next = replaceMarkdownImages(current, markdownImages(current), destinations)
          if (next !== current) {
            if (modeRef.current === 'source') sourceEditor.current?.write(next)
            else {
              const actual = muya.current?.replace(next) ?? next
              if (actual !== bodyRef.current) change(actual)
            }
          }
        }
        setNotice('图片处理完成:' + done + ' 张已转换为 WebP 并存储，' + skipped + ' 张已在图床；' + (urls.length - done - skipped) + ' 张保留原链接。文章尚未保存。')
        if (urls.length > 20) failures.push('每次最多处理 20 个不同链接，超出的图片保留原链接，可单独复制粘贴处理。')
        if (stopImages.current && attempted < urls.length) failures.push('已停止后续图片处理，未处理的图片保留原链接。')
        if (failures.length) setError(failures.join(' '))
      } finally {
        workingRef.current = false
        imageProgressRef.current = ''
        if (mounted.current) { setWorking(false); setImageProgress(''); setStoppingImages(false) }
      }
    })()
    return true
  }
  const insertImages = async (files: File[]) => {
    if (imageBlocked()) { if (document.article.kind === 'ai-daily') setError('图片只导入到正文或草稿文章旁边。'); return }
    workingRef.current = true; setWorking(true); setError('')
    try {
      let remote = false
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const result = await unwrap(api.importImage({ ...target, fileName: file.name || 'image.png', alt: file.name.replace(/\.[^.]+$/, '') || '图片', bytes }))
        if (!mounted.current) return
        remote = result.storage === 'remote'
        activeEditor()?.insert(`${result.markdown}\n`)
      }
      setNotice(remote ? '已上传并插入公开链接，没有保存本地副本。' : '已保存到文章同名图片目录，并插入相对引用。')
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }
  const chooseImage = async () => {
    if (imageBlocked()) return
    workingRef.current = true; setWorking(true); setError('')
    try {
      const result = await unwrap(api.chooseArticleImage(target))
      if (!result || !mounted.current) return
      activeEditor()?.insert(`${result.markdown}\n`)
      setNotice(result.storage === 'remote' ? '已上传并插入公开链接，没有保存本地副本。' : '已保存到文章同名图片目录，并插入相对引用。')
    } catch (cause) { setError(message(cause)) }
    finally { workingRef.current = false; setWorking(false) }
  }

  return <section className="article-editor" aria-label="文章编辑工作区">
    <div className="editor-heading"><Button size="small" variant="ghost" onClick={onBack} disabled={working}><ArrowLeft size={16} />返回列表</Button><div className="editor-heading-title"><strong>{base.current.article.title}</strong><span>{target.relativePath}</span></div><span className={cn('editor-save-state', dirty && 'is-dirty')}>{externalSession ? '外部编辑中' : dirty ? '未保存' : '已保存'}</span>{document.article.kind === 'draft' && <Button size="small" disabled={working || loadingRecovery || !!recovery || externalSession} onClick={() => { if (dirtyRef.current) setPublishPrompt(true); else void runPublish() }}><Send size={15} />发布到正文</Button>}<Button variant="primary" size="small" disabled={!dirty || working || loadingRecovery || !!recovery || externalSession} onClick={() => void save()}>{working ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存</Button></div>
    {error && <div className="editor-error" role="alert">{error}</div>}
    {imageProgress && <div className="recovery-prompt" role="status"><span>{imageProgress}</span><Button size="small" disabled={stoppingImages} onClick={() => { stopImages.current = true; setStoppingImages(true) }}>{stoppingImages ? '当前图片结束后停止...' : '停止后续图片'}</Button></div>}
    {externalSession && <section className="external-editor-guide" aria-label="正在使用外部编辑器"><ExternalLink size={52} strokeWidth={1.25} aria-hidden="true" /><h2>正在使用外部编辑器</h2><p>文件已使用系统默认程序打开，您可以在外部编辑器中进行编辑。编辑完成后，请点击下方按钮重新加载内容。</p><Button disabled={working} onClick={() => void finishExternal()}>{working ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}重新加载</Button></section>}
    <div className="editor-workspace" hidden={externalSession || undefined}>
    <div className="editor-toolbar"><div className="editor-tools"><Button size="icon" variant="ghost" title="撤销" aria-label="撤销" disabled={working || !!recovery || loadingRecovery || switching} onClick={() => activeEditor()?.undo()}><Undo2 size={15} /></Button><Button size="icon" variant="ghost" title="重做" aria-label="重做" disabled={working || !!recovery || loadingRecovery || switching} onClick={() => activeEditor()?.redo()}><Redo2 size={15} /></Button><Button size="small" variant="ghost" title={document.article.kind === 'ai-daily' ? '图片只导入到正文或草稿' : '选择图片。未启用 S3/R2 时保存到文章同名目录'} aria-label="插入图片" disabled={working || loadingRecovery || !!recovery || externalSession || switching || document.article.kind === 'ai-daily'} onClick={() => void chooseImage()}><ImagePlus size={15} />插入图片</Button><Button size="small" variant="ghost" title="用系统默认程序打开磁盘上的当前文章" aria-label="用外部编辑器打开" disabled={working || loadingRecovery || !!recovery} onClick={() => void requestExternal()}><ExternalLink size={15} />外部编辑器</Button><Button size="small" variant="ghost" title="在 Astro 本地站点中打开当前文章。这不是 Markdown 基础预览。" aria-label="在站点中预览" disabled={working || loadingRecovery || !!recovery || externalSession} onClick={() => void requestSitePreview()}><Globe size={15} />站点预览</Button><Button size="icon" variant="ghost" title="重新加载磁盘版本" aria-label="重新加载磁盘版本" disabled={working} onClick={() => dirty ? setReloadPrompt(true) : void reload()}><RotateCcw size={15} /></Button><Button size="icon" variant="ghost" title="另存编辑副本" aria-label="另存编辑副本" disabled={working} onClick={() => void exportCopy()}><FileDown size={15} /></Button></div><div className="editor-mode-switch" role="tablist" aria-label="编辑模式" onKeyDown={event => {
      if (isMdx || working || loadingRecovery || !!recovery || externalSession || switching || imageProgress) return
      const order: EditorMode[] = ['wysiwyg', 'source']
      let index = order.indexOf(mode)
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = Math.min(order.length - 1, index + 1)
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = Math.max(0, index - 1)
      else if (event.key === 'Home') index = 0
      else if (event.key === 'End') index = order.length - 1
      else return
      event.preventDefault()
      showMode(order[index], false)
    }}><button type="button" role="tab" id="editor-tab-wysiwyg" aria-controls="editor-wysiwyg-panel" aria-selected={mode === 'wysiwyg'} tabIndex={mode === 'wysiwyg' ? 0 : -1} disabled={isMdx || working || loadingRecovery || !!recovery || externalSession || switching || !!imageProgress} onClick={() => showMode('wysiwyg', true)}><PenLine size={14} aria-hidden="true" />编辑模式</button><button type="button" role="tab" id="editor-tab-source" aria-controls="editor-source-panel" aria-selected={mode === 'source'} tabIndex={mode === 'source' ? 0 : -1} disabled={working || loadingRecovery || !!recovery || externalSession || switching || !!imageProgress} onClick={() => showMode('source', true)}><Code2 size={14} aria-hidden="true" />源码模式</button></div></div>
    {isMdx && <p className="editor-mdx-note" role="note">MDX 包含可执行语法，仅支持源码编辑</p>}
    {recovery && <div className="recovery-prompt"><span>发现 {new Date(recovery.updatedAt).toLocaleString('zh-CN')} 的未保存内容。{recovery.baseRevision !== base.current.revision && '磁盘版本已变化，恢复后保存会先检查冲突。'}</span><Button size="small" onClick={restoreRecovery}>恢复到编辑器</Button><Button size="small" variant="ghost" onClick={() => void discard()}>放弃恢复记录</Button></div>}
    <div className="editor-panes">
      {!isMdx && <div id="editor-wysiwyg-panel" className="editor-source-pane" role="tabpanel" aria-labelledby="editor-tab-wysiwyg" hidden={mode !== 'wysiwyg'} inert={mode !== 'wysiwyg'}><MuyaEditor ref={muya} initialBody={initialParts.body} disabled={working || loadingRecovery || !!recovery || externalSession || switching || mode !== 'wysiwyg'} onChange={change} onSave={() => void save()} onImages={files => void insertImages(files)} onMarkdownPaste={pasteMarkdown} /></div>}
      <div id="editor-source-panel" className="editor-source-pane" role="tabpanel" aria-labelledby="editor-tab-source" hidden={mode !== 'source'} inert={mode !== 'source'}><p className="source-pane-label" id="markdown-source-label">Markdown 正文源码</p><SourceEditor ref={sourceEditor} initialBody={initialParts.body} visible={mode === 'source'} disabled={working || loadingRecovery || !!recovery || externalSession || switching || mode !== 'source'} onChange={change} onSave={() => void save()} onImages={files => void insertImages(files)} onMarkdownPaste={pasteMarkdown} /></div>
    </div>
    </div>
    <div className="editor-footer"><span role="status">{loadingRecovery ? '检查恢复记录...' : externalSession ? '编辑区已暂停。请在外部程序中修改，然后重新加载。' : notice || (dirty ? '编辑中，Ctrl+S 保存' : '本地文件 · Ctrl+S 保存')}</span><span>{mode === 'source' ? 'Markdown 源码编辑器' : 'Muya 所见即所得编辑器'}</span></div>
    {reloadPrompt && <Modal title="重新加载磁盘版本" onCancel={() => { if (!working) setReloadPrompt(false) }}><p>当前编辑会先写入恢复记录，再加载磁盘版本。之后可从恢复记录取回或导出副本。</p><div className="dialog-actions"><Button disabled={working} onClick={() => setReloadPrompt(false)}>取消</Button><Button disabled={working} variant="primary" onClick={() => void reload()}>保留编辑并加载</Button></div></Modal>}
    {externalPrompt === 'dirty' && <Modal title="用外部编辑器打开" onCancel={() => { if (!working) setExternalPrompt(null) }}><p>系统默认程序打开的是磁盘上的文章。打开后编辑区会暂停，直到重新加载。请先保存或放弃编辑区中的修改。取消会保留编辑区，并且不会打开外部程序。</p><div className="dialog-actions"><Button disabled={working} onClick={() => setExternalPrompt(null)}>取消</Button><Button disabled={working} onClick={() => void discardAndOpen()}>放弃修改并打开</Button><Button disabled={working} variant="primary" onClick={() => void saveAndOpen()}>保存并打开</Button></div></Modal>}
    {externalPrompt === 'stale' && <Modal title="磁盘内容已变化" onCancel={() => { if (!working) setExternalPrompt(null) }}><p>磁盘上的文章与编辑区打开时的版本不同。重新加载会替换编辑区。取消则保持编辑区，并且不打开外部编辑器。</p><div className="dialog-actions"><Button disabled={working} onClick={() => setExternalPrompt(null)}>取消</Button><Button disabled={working} variant="primary" onClick={() => void reloadAndOpen()}>重新加载并打开</Button></div></Modal>}
    {sitePrompt && <Modal title="在站点中预览" onCancel={() => { if (!working) setSitePrompt(false) }}><p>本地站点读取的是磁盘上的文章，不是编辑区里尚未保存的内容。请先保存或放弃修改。取消不会打开浏览器。保存失败或发生冲突时不会打开。</p><div className="dialog-actions"><Button disabled={working} onClick={() => setSitePrompt(false)}>取消</Button><Button disabled={working} onClick={() => void discardAndPreview()}>放弃修改并预览</Button><Button disabled={working} variant="primary" onClick={() => void saveAndPreview()}>保存并预览</Button></div></Modal>}
    {siteUnresolved && <Modal title="无法确定文章地址" onCancel={() => setSiteUnresolved(null)}><p>{siteUnresolved.message}</p><div className="dialog-actions"><Button onClick={() => setSiteUnresolved(null)}>取消</Button><Button variant="primary" disabled={!siteUnresolved.homepage} onClick={() => void (async () => { try { await unwrap(api.openPreviewHome()); setNotice('已打开站点首页。尚未打开具体文章。'); setSiteUnresolved(null) } catch (cause) { setError(message(cause)) } })()}>打开站点首页</Button></div></Modal>}
    {publishPrompt && <Modal title="发布到正文" onCancel={() => { if (!working) setPublishPrompt(false) }}><p>这只把草稿文件和它的同名图片目录移动到 src/contents/post。不会提交 Git，也不会构建或部署。请先保存或放弃编辑区里的修改。保存失败或磁盘版本冲突时不会移动文件。</p><div className="dialog-actions"><Button disabled={working} onClick={() => setPublishPrompt(false)}>取消</Button><Button disabled={working} onClick={() => void discardAndPublish()}>放弃修改并发布</Button><Button disabled={working} variant="primary" onClick={() => void saveAndPublish()}>保存并发布</Button></div></Modal>}
  </section>
})
