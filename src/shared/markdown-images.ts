import { fromMarkdown } from 'mdast-util-from-markdown'

export interface MarkdownImage { from: number; to: number; url: string; replacement(destination: string): string }
interface Node {
  type: string; url?: string; alt?: string | null; title?: string | null; identifier?: string; value?: string
  children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } }
}
const escapeText = (text: string) => text.replace(/([\\[\]])/g, '\\$1').replace(/[\r\n]/g, ' ')

/** Parse Markdown rather than matching code samples or ordinary links as images. */
export function markdownImages(source: string): MarkdownImage[] {
  const frontmatter = /^\uFEFF?---[\t ]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/.exec(source)
  const masked = frontmatter ? frontmatter[0].replace(/[^\r\n]/g, ' ') + source.slice(frontmatter[0].length) : source
  const tree: Node = fromMarkdown(masked)
  const definitions = new Map<string, Node>()
  const walk = (node: Node, callback: (node: Node) => void) => { callback(node); node.children?.forEach(child => walk(child, callback)) }
  walk(tree, node => { if (node.type === 'definition' && node.identifier && !definitions.has(node.identifier)) definitions.set(node.identifier, node) })
  const images: MarkdownImage[] = []
  walk(tree, node => {
    const from = node.position?.start.offset, to = node.position?.end.offset
    if (from === undefined || to === undefined) return
    const target = node.type === 'imageReference' ? definitions.get(node.identifier ?? '') : node.type === 'image' ? node : undefined
    if (target?.url && /^https?:\/\//i.test(target.url)) {
      const title = target.title ? ` "${target.title.replace(/([\\"])/g, '\\$1').replace(/[\r\n]/g, ' ')}"` : ''
      images.push({ from, to, url: target.url, replacement: destination => `![${escapeText(node.alt ?? '')}](<${destination}>${title})` })
    }
    if (node.type === 'html') {
      const raw = source.slice(from, to)
      // Ignore comments; only the src attribute of real img tags is replaced.
      for (const tag of raw.matchAll(/<!--[\s\S]*?-->|<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
        if (tag[0].startsWith('<!--')) continue
        const attr = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0])
        if (!attr) continue
        const value = attr[1] ?? attr[2] ?? attr[3]
        const url = value.replace(/&amp;/gi, '&')
        if (!/^https?:\/\//i.test(url)) continue
        const offset = from + tag.index! + attr.index + attr[0].indexOf(value)
        images.push({ from: offset, to: offset + value.length, url, replacement: destination => destination.replace(/&/g, '&amp;').replace(/"/g, '%22').replace(/'/g, '%27') })
      }
    }
  })
  return images.sort((a, b) => a.from - b.from)
}

export function imageUrlKey(value: string): string {
  try { const url = new URL(value); url.hash = ''; return url.href } catch { return value }
}

export function replaceMarkdownImages(source: string, images: MarkdownImage[], destinations: Map<string, string>): string {
  let result = source
  for (const image of [...images].reverse()) {
    const destination = destinations.get(imageUrlKey(image.url))
    if (destination) result = result.slice(0, image.from) + image.replacement(destination) + result.slice(image.to)
  }
  return result
}
