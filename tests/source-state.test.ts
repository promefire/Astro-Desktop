import { describe, expect, it } from 'vitest'
import { EditorState, Transaction } from '@codemirror/state'
import { history, undo, redo } from '@codemirror/commands'
import { markdownBody, sourceState } from '../src/renderer/src/editor/source-state'

describe('CodeMirror raw source fidelity', () => {
  it('preserves untouched mixed endings and BOM through grouped undo and redo', () => {
    const initial = '\uFEFF---\r\ntitle: 测试\n---\r\n正文\n末行'
    const raw = sourceState(initial)
    let state = EditorState.create({ doc: initial, extensions: [raw.extension, history()] })
    const dispatch = (tr: Transaction) => { state = tr.state }
    const apply = (text: string) => dispatch(state.update({ changes: { from: state.doc.length, insert: text }, annotations: Transaction.userEvent.of('input.type') }))
    apply('A'); apply('B'); apply('\n下一行')
    const edited = initial + 'AB\r\n下一行'
    expect(state.field(raw.field)).toBe(edited)
    expect(undo({ state, dispatch })).toBe(true)
    expect(state.field(raw.field)).toBe(initial)
    expect(state.doc.toString()).toBe(initial.replace(/\r\n/g, '\n'))
    expect(redo({ state, dispatch })).toBe(true)
    expect(state.field(raw.field)).toBe(edited)
    expect(state.doc.toString()).toBe(edited.replace(/\r\n/g, '\n'))
  })
  it('maps multi-range edits across mixed newlines and UTF-16 characters', () => {
    const initial = '首😀\r\n二\n三\r四'
    const raw = sourceState(initial)
    const state = EditorState.create({ doc: initial, extensions: raw.extension })
    const next = state.update({ changes: [{ from: 1, to: 3, insert: '文' }, { from: 5, to: 6, insert: '\n新增\n' }] }).state
    expect(next.field(raw.field)).toBe('首文\r\n二\r\n新增\r\n三\r四')
    expect(next.doc.toString()).toBe(next.field(raw.field).replace(/\r\n|\r/g, '\n'))
  })
  it('previews only the body and handles incomplete metadata without leaking it', () => {
    expect(markdownBody('\uFEFF---\r\ntitle: 测试\r\n---\r\n# 正文')).toBe('# 正文')
    expect(markdownBody('---\ntitle: 未关闭')).toBe('')
    expect(markdownBody('# 普通文本')).toBe('# 普通文本')
  })
})
