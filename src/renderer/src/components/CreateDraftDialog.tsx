import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, FilePlus2, LoaderCircle, Plus, X } from 'lucide-react'
import type { CreateDraftInput } from '../../../shared/contracts'
import { Badge, Button, Input } from './ui'

type DraftFields = Omit<CreateDraftInput, 'projectPath'>
interface Props {
  categories: string[]; availableTags: string[];
  onCreate: (fields: DraftFields) => Promise<void>; onClose: () => void;
}

export function CreateDraftDialog({ categories, availableTags, onCreate, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current!
    const previousFocus = window.document.activeElement
    element.showModal()
    titleInput.current?.focus()
    return () => {
      element.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  function addTag() {
    const value = tagInput.trim()
    if (!value) return
    if (tags.length >= 32 && !tags.includes(value)) { setError('最多添加 32 个标签。'); return }
    setTags(current => [...new Set([...current, value])])
    setTagInput('')
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submittingRef.current || !title.trim()) return
    const allTags = [...new Set([...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])])]
    if (allTags.length > 32) { setError('最多添加 32 个标签。'); return }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      await onCreate({ title: title.trim(), category: category.trim(), tags: allTags, description: description.trim() })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败，请重试。')
    } finally { submittingRef.current = false; setSubmitting(false) }
  }

  return <dialog className="create-dialog" ref={dialog} aria-labelledby="create-draft-title" aria-describedby="create-draft-hint" onCancel={event => { event.preventDefault(); if (!submittingRef.current) onClose() }}>
    <form onSubmit={event => void submit(event)} aria-busy={submitting}>
      <div className="create-dialog-heading"><div><span className="dialog-overline"><FilePlus2 size={15} />普通文章</span><h2 id="create-draft-title">创建新文章</h2></div><Button type="button" variant="ghost" size="icon" aria-label="关闭新建文章" disabled={submitting} onClick={onClose}><X size={18} /></Button></div>
      <p id="create-draft-hint" className="create-dialog-hint">新文章默认保存到草稿，日期使用当前本地时间。</p>
      <fieldset disabled={submitting}>
        <div className="draft-field"><label htmlFor="draft-title">文章标题 <span aria-hidden="true">*</span></label><Input ref={titleInput} id="draft-title" required maxLength={200} placeholder="请输入文章标题" value={title} onChange={event => setTitle(event.target.value)} /></div>
        <div className="draft-field"><label htmlFor="draft-tags">标签</label><div className="draft-tag-input"><Input id="draft-tags" list="draft-tag-options" maxLength={80} placeholder="输入标签后按回车添加" value={tagInput} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTag() } }} /><Button type="button" size="icon" aria-label="添加标签" disabled={!tagInput.trim() || submitting} onClick={addTag}><Plus size={17} /></Button></div><datalist id="draft-tag-options">{availableTags.filter(tag => !tags.includes(tag)).map(tag => <option key={tag} value={tag} />)}</datalist>{tags.length > 0 && <div className="draft-tags">{tags.map(tag => <Badge key={tag} tone="accent">{tag}<button type="button" aria-label={`移除标签：${tag}`} onClick={() => setTags(current => current.filter(value => value !== tag))}><X size={12} /></button></Badge>)}</div>}</div>
        <div className="draft-field"><label htmlFor="draft-category">分类 <small>可选，选择或输入一个分类</small></label><Input id="draft-category" list="draft-category-options" maxLength={80} placeholder="选择已有分类或输入新分类" value={category} onChange={event => setCategory(event.target.value)} /><datalist id="draft-category-options">{categories.map(value => <option key={value} value={value} />)}</datalist></div>
        <div className="draft-field"><label htmlFor="draft-description">摘要 <small>可选</small></label><textarea className="input" id="draft-description" maxLength={2000} rows={3} placeholder="请输入文章摘要" value={description} onChange={event => setDescription(event.target.value)} /></div>
      </fieldset>
      {error && <div className="draft-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
      <div className="create-dialog-footer"><span>同名文章会自动添加序号</span><Button type="button" disabled={submitting} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={submitting || !title.trim()}>{submitting ? <><LoaderCircle className="spin" size={15} />正在创建…</> : '创建草稿'}</Button></div>
    </form>
  </dialog>
}
