export interface MarkdownSourceParts {
  /** The BOM and complete frontmatter block, preserved byte-for-byte. */
  frontmatter: string
  body: string
  /** True when the source starts with a frontmatter delimiter but has no closing delimiter. */
  unclosedFrontmatter: boolean
}

/** Split a complete Markdown document without normalising its line endings. */
export function splitMarkdownSource(source: string): MarkdownSourceParts {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const content = source.slice(bom.length)
  const opening = /^---[\t ]*(?:\r\n|\n|\r)/.exec(content)
  if (!opening) return { frontmatter: bom, body: content, unclosedFrontmatter: false }

  const remaining = content.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[\t ]*(?:(?:\r\n|\n|\r)|$)/m.exec(remaining)
  if (!closing) return { frontmatter: '', body: source, unclosedFrontmatter: true }

  const end = bom.length + opening[0].length + closing.index + closing[0].length
  return { frontmatter: source.slice(0, end), body: source.slice(end), unclosedFrontmatter: false }
}

/** Line-ending-only comparison. Other whitespace and characters still count as changes. */
export function sameMarkdown(left: string, right: string): boolean {
  return left.replace(/\r\n|\r/g, '\n') === right.replace(/\r\n|\r/g, '\n')
}

/** Extract the Markdown body (content after the closing frontmatter delimiter). */
export function markdownBody(source: string): string {
  const parts = splitMarkdownSource(source)
  return parts.unclosedFrontmatter ? '' : parts.body
}
