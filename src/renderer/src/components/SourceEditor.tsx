import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands'
import { searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { sourceState } from '../editor/source-state'

export interface SourceEditorHandle { replace(source: string): void; insert(markdown: string): void; undo(): void; redo(): void; find(): void; focus(): void }
interface Props { initialSource: string; disabled: boolean; onChange(source: string): void; onSave(): void; onCursor(line: number, column: number): void; onImages(files: File[]): void }

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const editable = useRef(new Compartment())
  const takeImages = (list: FileList | undefined) => {
    if (callbacks.current.disabled) return false
    const files = [...(list ?? [])].filter(file => file.type.startsWith('image/'))
    if (!files.length) return false
    callbacks.current.onImages(files)
    return true
  }
  const makeState = (source: string) => {
    const raw = sourceState(source)
    return EditorState.create({ doc: source, extensions: [
      raw.extension, lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history({ minDepth: source.length > 1024 * 1024 ? 20 : 100 }),
      drawSelection(), dropCursor(), rectangularSelection(), highlightActiveLine(), highlightSelectionMatches(), foldGutter(), indentOnInput(), bracketMatching(), yamlFrontmatter({ content: markdown() }), EditorView.lineWrapping,
      editable.current.of([EditorState.readOnly.of(callbacks.current.disabled), EditorView.editable.of(!callbacks.current.disabled)]),
      EditorView.contentAttributes.of({ 'aria-label': '文章源码编辑器', spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.domEventHandlers({
        paste(event) {
          if (!takeImages(event.clipboardData?.files)) return false
          event.preventDefault()
          return true
        },
        drop(event) {
          if (!takeImages(event.dataTransfer?.files)) return false
          event.preventDefault()
          return true
        },
      }),
      syntaxHighlighting(HighlightStyle.define([
        { tag: tags.heading, color: 'var(--accent-text)', fontWeight: '600' },
        { tag: [tags.link, tags.url], color: 'var(--accent-text)', textDecoration: 'underline' },
        { tag: [tags.string, tags.monospace], color: 'var(--success)' },
        { tag: [tags.propertyName, tags.bool, tags.number], color: 'var(--accent-text)' },
        { tag: [tags.meta, tags.comment], color: 'var(--muted)' },
        { tag: tags.strong, fontWeight: '700' }, { tag: tags.emphasis, fontStyle: 'italic' },
      ])),
      EditorView.updateListener.of(update => {
        if (update.docChanged) callbacks.current.onChange(update.state.field(raw.field))
        if (update.selectionSet || update.docChanged) {
          const cursor = update.state.selection.main.head, line = update.state.doc.lineAt(cursor)
          callbacks.current.onCursor(line.number, cursor - line.from + 1)
        }
      }),
    ] })
  }
  useImperativeHandle(ref, () => ({
    replace(source) { view.current?.setState(makeState(source)); callbacks.current.onChange(source) },
    insert(markdown) {
      const editor = view.current
      if (!editor) return
      const doc = editor.state.doc.toString()
      let from = editor.state.selection.main.from
      let to = editor.state.selection.main.to
      const fence = /^---[^\n]*\n[\s\S]*?\n---[^\n]*(?:\n|$)/.exec(doc)
      if (fence && to <= fence[0].length) from = to = fence[0].length
      const prefix = from > 0 && doc[from - 1] !== '\n' ? '\n' : ''
      const text = `${prefix}${markdown}\n`
      editor.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
      editor.focus()
    },
    undo() { if (view.current) { undo(view.current); view.current.focus() } },
    redo() { if (view.current) { redo(view.current); view.current.focus() } },
    find() { if (view.current) openSearchPanel(view.current) },
    focus() { view.current?.focus() },
  }))
  useEffect(() => {
    const editor = new EditorView({ state: makeState(callbacks.current.initialSource), parent: host.current! })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [])
  useEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(props.disabled), EditorView.editable.of(!props.disabled)]) }) }, [props.disabled])
  return <div className="code-editor-host" ref={host} />
})
