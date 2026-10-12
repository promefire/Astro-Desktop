import { StateEffect, StateField, type ChangeSet, type Extension } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'

/** CodeMirror counts each line break as one character; disk text need not. */
export function applySourceChanges(source: string, changes: ChangeSet): string {
  const newline = /\r\n|\r|\n/.exec(source)?.[0] ?? '\n'
  let rawPosition = 0, normalizedPosition = 0, copiedTo = 0
  let result = ''
  function offset(position: number): number {
    while (normalizedPosition < position) {
      rawPosition += source[rawPosition] === '\r' && source[rawPosition + 1] === '\n' ? 2 : 1
      normalizedPosition++
    }
    return rawPosition
  }
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const start = offset(from), end = offset(to)
    result += source.slice(copiedTo, start) + inserted.toString().replace(/\n/g, newline)
    copiedTo = end
  })
  return result + source.slice(copiedTo)
}

export function sourceState(initial: string): { field: StateField<string>; extension: Extension } {
  const restore = StateEffect.define<string>()
  const field = StateField.define<string>({
    create: () => initial,
    update(source, transaction) {
      const restored = transaction.effects.filter(effect => effect.is(restore)).at(-1)
      if (restored) return restored.value
      return transaction.docChanged ? applySourceChanges(source, transaction.changes) : source
    },
  })
  return { field, extension: [field, invertedEffects.of(transaction => transaction.docChanged ? [restore.of(transaction.startState.field(field))] : [])] }
}

export function markdownBody(source: string): string {
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(source)
  if (!opening) return source.replace(/^\uFEFF/, '')
  const remaining = source.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/m.exec(remaining)
  return closing ? remaining.slice(closing.index + closing[0].length) : ''
}
