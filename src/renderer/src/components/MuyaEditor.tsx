import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Muya } from '@muyajs/core'
import '@muyajs/core/lib/core.css'

export interface MuyaEditorHandle {
  undo(): void
  redo(): void
  insert(markdown: string): void
  replace(source: string): void
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
      if (!instance) return
      suppressingRef.current = true
      instance.setContent(instance.getMarkdown() + markdown)
      suppressingRef.current = false
      onChangeRef.current(instance.getMarkdown())
      instance.focus()
    },
    replace: (source: string) => {
      const instance = muyaRef.current
      if (!instance) return
      initialBodyRef.current = source
      suppressingRef.current = true
      instance.setContent(source)
      suppressingRef.current = false
      onChangeRef.current(source)
    },
    focus: () => { muyaRef.current?.focus() },
  }))

  useEffect(() => {
    if (!hostRef.current) return
    const muya = new Muya(hostRef.current, {
      markdown: initialBodyRef.current,
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
      muyaRef.current.setContent(props.initialBody)
      suppressingRef.current = false
      onChangeRef.current(props.initialBody)
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

  return <div ref={hostRef} className="muya-editor-host" style={{ height: '100%' }} aria-label="文章编辑器" />
})
