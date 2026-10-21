import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Muya, ParagraphQuickInsertMenu, zh } from '@muyajs/core'
import '@muyajs/core/lib/core.css'

// 注册 Marktext 同款 "/" 快捷插入菜单（WYSIWYG 模式）。
// Muya 的 plugins 是类级静态数组，全局只需注册一次。
Muya.use(ParagraphQuickInsertMenu)

// Muya's Markdown parser expects LF; leave the original source in ArticleEditor.
const editorMarkdown = (source: string) => source.replace(/\r\n|\r/g, '\n')

/** 快捷键到块类型的映射（与菜单项的 shortKeyMap 一致，仅含主修饰键） */
const SHORTCUT_LABELS: Record<string, string> = {
  '0': 'paragraph',
  '1': 'atx-heading 1',
  '2': 'atx-heading 2',
  '3': 'atx-heading 3',
  '4': 'atx-heading 4',
  '5': 'atx-heading 5',
  '6': 'atx-heading 6',
}

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
  htmlEnabled: boolean
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
  const htmlEnabledRef = useRef(props.htmlEnabled)
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
      disableHtml: !htmlEnabledRef.current,
      frontMatter: false,
      spellcheckEnabled: false,
      focusMode: false,
      codeBlockLineNumbers: true,
      autoPairBracket: true,
      autoPairMarkdownSyntax: true,
      autoPairQuote: true,
      locale: zh,
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
    const instance = muyaRef.current
    if (!instance || htmlEnabledRef.current === props.htmlEnabled) return
    htmlEnabledRef.current = props.htmlEnabled
    ;(instance as unknown as { options: { disableHtml: boolean } }).options.disableHtml = !props.htmlEnabled
    const token = ++suppressToken.current
    suppressingRef.current = true
    instance.setContent(instance.getMarkdown())
    requestAnimationFrame(() => requestAnimationFrame(() => { if (suppressToken.current === token) suppressingRef.current = false }))
  }, [props.htmlEnabled])

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

  // Ctrl+S 保存 + Ctrl/Cmd+0~6 快捷块转换
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        if (!disabledRef.current) onSaveRef.current()
        return
      }
      // 快捷块转换：Ctrl/Cmd + 0~6
      handleBlockShortcut(event)
    }
    host.addEventListener('keydown', handleKeyDown, true)
    return () => host.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  /**
   * 将当前段落按快捷键转换为目标块类型。
   * 通过 Muya 内部的区块注册表 R（scrollPage.constructor）创建新区块，
   * 并用 replaceWith 替换当前段落。
   */
  function handleBlockShortcut(event: KeyboardEvent) {
    if (!event.ctrlKey && !event.metaKey) return
    if (event.shiftKey || event.altKey) return

    const label = SHORTCUT_LABELS[event.key]
    if (!label) return

    const muya = muyaRef.current
    if (!muya || disabledRef.current) return

    // 获取当前选区，确认光标在段落内
    const selection = (muya.editor as unknown as {
      selection: { getSelection: () => { anchorBlock: any; isSelectionInSameBlock: boolean } }
    }).selection.getSelection()

    const anchorBlock = selection?.anchorBlock
    if (!anchorBlock || !selection.isSelectionInSameBlock) return

    // 段落的父块才是可替换的段落块
    const paragraphBlock = anchorBlock.parent
    if (!paragraphBlock || paragraphBlock.blockName !== 'paragraph') return

    // 获取当前段落文本（用于标题时保留文字）
    const currentText = anchorBlock.text || ''

    event.preventDefault()
    event.stopPropagation()

    // 通过 scrollPage 构造函数访问区块注册表 R
    const scrollPage = muya.editor.scrollPage
    if (!scrollPage) return
    const ScrollPageClass = scrollPage.constructor as unknown as {
      loadBlock: (name: string) => {
        create: (muya: any, state: any) => any
      }
    }

    let newBlock: any = null

    if (label === 'paragraph') {
      // 转换为普通段落
      const BlockClass = ScrollPageClass.loadBlock('paragraph')
      newBlock = BlockClass.create(muya, { name: 'paragraph', text: currentText })
    } else if (label.startsWith('atx-heading')) {
      const level = Number(label.split(' ')[1])
      const BlockClass = ScrollPageClass.loadBlock('atx-heading')
      newBlock = BlockClass.create(muya, {
        name: 'atx-heading',
        meta: { level },
        text: '#'.repeat(level) + ' ' + currentText,
      })
    }

    if (!newBlock) return

    // 替换段落块并定位光标
    paragraphBlock.replaceWith(newBlock, 'user')
    const cursorTarget = newBlock.firstContentInDescendant()
    if (cursorTarget && typeof cursorTarget.setCursor === 'function') {
      cursorTarget.setCursor(cursorTarget.text.length, cursorTarget.text.length, true)
    }
  }

  return <div ref={hostRef} className="muya-editor-host" inert={props.disabled} aria-label="文章编辑器" />
})
