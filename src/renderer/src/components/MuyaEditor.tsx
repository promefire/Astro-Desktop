import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Muya } from '@muyajs/core'
import '@muyajs/core/lib/core.css'

// Muya's Markdown parser expects LF; leave the original source in ArticleEditor.
const editorMarkdown = (source: string) => source.replace(/\r\n|\r/g, '\n')

export interface MuyaEditorHandle {
  undo(): void
  redo(): void
  insert(markdown: string): boolean
  /** Load Markdown without notifying. Returns the Markdown Muya actually stores. */
  replace(source: string): string
  getMarkdown(): string
  focus(): void
}

interface Props {
  initialBody: string
  disabled: boolean
  onChange(body: string): void
  onSave(): void
  onImages(files: File[]): void
  onMarkdownPaste(text: string): boolean
}

export const MuyaEditor = forwardRef<MuyaEditorHandle, Props>(function MuyaEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const muyaRef = useRef<Muya | null>(null)

  const initialBodyRef = useRef(props.initialBody)
  const disabledRef = useRef(props.disabled)
  const onChangeRef = useRef(props.onChange)
  const onSaveRef = useRef(props.onSave)
  const onImagesRef = useRef(props.onImages)
  const onMarkdownPasteRef = useRef(props.onMarkdownPaste)
  const suppressingRef = useRef(false)
  const suppressToken = useRef(0)

  useEffect(() => { onChangeRef.current = props.onChange }, [props.onChange])
  useEffect(() => { onSaveRef.current = props.onSave }, [props.onSave])
  useEffect(() => { onImagesRef.current = props.onImages }, [props.onImages])
  useEffect(() => { onMarkdownPasteRef.current = props.onMarkdownPaste }, [props.onMarkdownPaste])
  useEffect(() => { disabledRef.current = props.disabled }, [props.disabled])

  useImperativeHandle(ref, () => ({
    undo: () => { muyaRef.current?.focus(); muyaRef.current?.undo(); muyaRef.current?.focus() },
    redo: () => { muyaRef.current?.focus(); muyaRef.current?.redo(); muyaRef.current?.focus() },
    insert: (markdown: string) => {
      const instance = muyaRef.current
      if (!instance) return false
      suppressingRef.current = true
      instance.setContent(instance.getMarkdown() + editorMarkdown(markdown))
      suppressingRef.current = false
      onChangeRef.current(instance.getMarkdown())
      instance.focus()
      return true
    },
    replace: (source: string) => {
      const instance = muyaRef.current
      const normalized = editorMarkdown(source)
      if (!instance) return normalized
      if (instance.getMarkdown() === normalized) return instance.getMarkdown()
      initialBodyRef.current = source
      const token = ++suppressToken.current
      suppressingRef.current = true
      instance.setContent(normalized)
      const actual = instance.getMarkdown()
      // setContent can cause a follow-up input event on a later frame. Ignore that echo.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (suppressToken.current === token) suppressingRef.current = false }))
      return actual
    },
    getMarkdown: () => muyaRef.current?.getMarkdown() ?? editorMarkdown(initialBodyRef.current),
    focus: () => { muyaRef.current?.focus() },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // Muya replaces its input element, then removes the replacement on destroy.
    // Keep React's host stable across StrictMode setup/cleanup and article changes.
    const mount = document.createElement('div')
    mount.setAttribute('role', 'textbox')
    mount.setAttribute('aria-label', '文章正文')
    mount.setAttribute('aria-multiline', 'true')
    host.appendChild(mount)
    const muya = new Muya(mount, {
      markdown: editorMarkdown(initialBodyRef.current),
      disableHtml: true,
      frontMatter: false,
      spellcheckEnabled: false,
      focusMode: false,
      codeBlockLineNumbers: true,
      autoPairBracket: true,
      autoPairMarkdownSyntax: true,
      autoPairQuote: true,
    })
    muya.init()
    muya.on('json-change', ({ source }) => {
      if (suppressingRef.current) return
      if (source === 'user') onChangeRef.current(muya.getMarkdown())
    })
    muyaRef.current = muya
    return () => { muya.destroy(); muyaRef.current = null }
  }, [])

  useEffect(() => {
    if (muyaRef.current && props.initialBody !== initialBodyRef.current) {
      initialBodyRef.current = props.initialBody
      suppressingRef.current = true
      muyaRef.current.setContent(editorMarkdown(props.initialBody))
      suppressingRef.current = false
    }
  }, [props.initialBody])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handlePaste = (event: ClipboardEvent) => {
      if (disabledRef.current) return
      const files = event.clipboardData?.files
      if (files && files.length > 0) {
        const imageFiles = [...files].filter(file => file.type.startsWith('image/'))
        if (imageFiles.length > 0) {
          event.preventDefault()
          event.stopImmediatePropagation()
          onImagesRef.current(imageFiles)
          return
        }
      }
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (text && onMarkdownPasteRef.current(text)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    host.addEventListener('paste', handlePaste, true)
    return () => host.removeEventListener('paste', handlePaste, true)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handleDrop = (event: DragEvent) => {
      if (disabledRef.current) return
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return
      const imageFiles = [...files].filter(file => file.type.startsWith('image/'))
      if (imageFiles.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        onImagesRef.current(imageFiles)
      }
    }
    host.addEventListener('drop', handleDrop)
    return () => host.removeEventListener('drop', handleDrop)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        if (!disabledRef.current) onSaveRef.current()
      }
    }
    host.addEventListener('keydown', handleKeyDown, true)
    return () => host.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return <div ref={hostRef} className="muya-editor-host" inert={props.disabled} aria-label="文章编辑器" />
})
