/** Extract the Markdown body (content after the closing frontmatter delimiter). */
export function markdownBody(source: string): string {
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(source)
  if (!opening) return source.replace(/^\uFEFF/, '')
  const remaining = source.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/m.exec(remaining)
  return closing ? remaining.slice(closing.index + closing[0].length) : ''
}
