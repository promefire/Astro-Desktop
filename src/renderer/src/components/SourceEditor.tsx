import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export interface SourceEditorHandle {
  undo(): void
  redo(): void
  insert(markdown: string): boolean
  /** Replace the document without recording a history event or notifying the parent. */
  replace(markdown: string): void
  /** Replace the document as a user edit, keeping history and notifying once. */
  write(markdown: string): void
  getMarkdown(): string
  focus(): void
}

interface Props {
  initialBody: string
  disabled: boolean
  visible: boolean
  onChange(body: string): void
  onSave(): void
  onImages(files: File[]): void
  onMarkdownPaste(text: string): boolean
}

const lightHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#6140a7', fontWeight: '650' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.keyword, color: '#7250ba' },
  { tag: tags.string, color: '#2f6b4f' },
  { tag: tags.comment, color: '#888491' },
  { tag: tags.link, color: '#6140a7' },
  { tag: tags.url, color: '#686573' },
  { tag: tags.monospace, color: '#8a5a12' },
])

const darkHighlight = HighlightStyle.define([
  { tag: tags.heading, color: '#c3a7f2', fontWeight: '650' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.keyword, color: '#b097e1' },
  { tag: tags.string, color: '#91b8a0' },
  { tag: tags.comment, color: '#96909f' },
  { tag: tags.link, color: '#c3a7f2' },
  { tag: tags.url, color: '#aca6b8' },
  { tag: tags.monospace, color: '#e1bc7e' },
])

const editorTheme = (dark: boolean) => EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei UI", monospace', fontSize: '13px', lineHeight: '1.7', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text)', color: 'var(--text)', padding: '12px 0 80px' },
  '.cm-gutters': { backgroundColor: 'var(--subtle)', color: 'var(--muted)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft)' },
  '.cm-search': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-textfield': { backgroundColor: 'var(--subtle)', color: 'var(--text)', border: '1px solid var(--border)' },
  '.cm-button': { backgroundColor: 'var(--subtle)', color: 'var(--text)', backgroundImage: 'none', border: '1px solid var(--border)' },
  '.cm-panel.cm-search': { borderBottom: '1px solid var(--border)' },
}, { dark })

const isDark = () => document.documentElement.dataset.theme === 'dark'

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const extensionsRef = useRef<Extension[] | null>(null)
  const themeRef = useRef<Compartment | null>(null)
  const highlightRef = useRef<Compartment | null>(null)
  const editableRef = useRef<Compartment | null>(null)
  const latestBody = useRef(props.initialBody)
  const disabledRef = useRef(props.disabled)
  const suppressingRef = useRef(false)
  const onChangeRef = useRef(props.onChange)
  const onSaveRef = useRef(props.onSave)
  const onImagesRef = useRef(props.onImages)
  const onMarkdownPasteRef = useRef(props.onMarkdownPaste)
  latestBody.current = props.initialBody

  useEffect(() => { onChangeRef.current = props.onChange }, [props.onChange])
  useEffect(() => { onSaveRef.current = props.onSave }, [props.onSave])
  useEffect(() => { onImagesRef.current = props.onImages }, [props.onImages])
  useEffect(() => { onMarkdownPasteRef.current = props.onMarkdownPaste }, [props.onMarkdownPaste])
  useEffect(() => { disabledRef.current = props.disabled }, [props.disabled])

  useImperativeHandle(ref, () => ({
    undo: () => { const view = viewRef.current; if (!view) return; view.focus(); undo(view) },
    redo: () => { const view = viewRef.current; if (!view) return; view.focus(); redo(view) },
    insert: markdown => {
      const view = viewRef.current
      // The parent disables the surface while it imports an image, then inserts the
      // resulting Markdown itself. That programmatic insert must still land.
      if (!view) return false
      const range = view.state.selection.main
      view.focus()
      view.dispatch({ changes: { from: range.from, to: range.to, insert: markdown }, selection: { anchor: range.from + markdown.length } })
      return true
    },
    replace: markdown => {
      const view = viewRef.current
      const extensions = extensionsRef.current
      if (!view || !extensions || view.state.doc.toString() === markdown) return
      suppressingRef.current = true
      view.setState(EditorState.create({ doc: markdown, extensions }))
      suppressingRef.current = false
      view.requestMeasure()
    },
    write: markdown => {
      const view = viewRef.current
      if (!view || view.state.doc.toString() === markdown) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: markdown } })
    },
    getMarkdown: () => viewRef.current?.state.doc.toString() ?? latestBody.current,
    focus: () => { viewRef.current?.requestMeasure(); viewRef.current?.focus() },
  }))

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return
    const theme = new Compartment()
    const highlight = new Compartment()
    const editable = new Compartment()
    const dark = isDark()
    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      markdown(),
      highlight.of(syntaxHighlighting(dark ? darkHighlight : lightHighlight)),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab, ...searchKeymap]),
      search({ top: true }),
      Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { if (!disabledRef.current) onSaveRef.current(); return true } }])),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文源码', 'aria-multiline': 'true' }),
      theme.of(editorTheme(dark)),
      editable.of(EditorView.editable.of(!disabledRef.current)),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !suppressingRef.current) onChangeRef.current(update.state.doc.toString())
      }),
      EditorView.domEventHandlers({
        paste(event) {
          if (disabledRef.current) return false
          const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
          if (files.length) { event.preventDefault(); onImagesRef.current(files); return true }
          const text = event.clipboardData?.getData('text/plain') ?? ''
          if (text && onMarkdownPasteRef.current(text)) { event.preventDefault(); return true }
          return false
        },
        drop(event) {
          if (disabledRef.current) return false
          const files = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'))
          if (!files.length) return false
          event.preventDefault()
          onImagesRef.current(files)
          return true
        },
      }),
    ]
    const view = new EditorView({ parent, state: EditorState.create({ doc: latestBody.current, extensions }) })
    viewRef.current = view
    extensionsRef.current = extensions
    themeRef.current = theme
    highlightRef.current = highlight
    editableRef.current = editable
    const observer = new MutationObserver(() => {
      const nextDark = isDark()
      view.dispatch({ effects: [theme.reconfigure(editorTheme(nextDark)), highlight.reconfigure(syntaxHighlighting(nextDark ? darkHighlight : lightHighlight))] })
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { observer.disconnect(); view.destroy(); viewRef.current = null; extensionsRef.current = null }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    const editable = editableRef.current
    if (!view || !editable) return
    view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!props.disabled)) })
  }, [props.disabled])

  useEffect(() => { if (props.visible) viewRef.current?.requestMeasure() }, [props.visible])

  return <div ref={hostRef} className="markdown-source-host" />
})
