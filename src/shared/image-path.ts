const REMOTE = /^[a-z][a-z0-9+.-]*:/i

export function articleStem(relativePath: string): string {
  const name = relativePath.split('/').at(-1) ?? ''
  return name.replace(/\.mdx?$/i, '')
}

export function assetDirectory(relativePath: string): string {
  const parts = relativePath.split('/')
  const stem = articleStem(relativePath)
  return [...parts.slice(0, -1), stem].join('/')
}

/** Encode one path segment so spaces and reserved characters survive Markdown. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function localImageDestination(articlePath: string, fileName: string): string {
  return `./${encodePathSegment(articleStem(articlePath))}/${encodePathSegment(fileName)}`
}

export function imageMarkdown(alt: string, destination: string): string {
  const safeAlt = alt.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || '图片'
  return `![${safeAlt}](${destination})`
}

export function resolveMarkdownPath(fromFile: string, destination: string): string | null {
  const raw = destination.trim()
  if (!raw || REMOTE.test(raw) || raw.startsWith('//') || raw.startsWith('#')) return null
  const withoutSuffix = raw.split(/[?#]/, 1)[0] ?? ''
  let decoded = withoutSuffix
  try { decoded = decodeURIComponent(withoutSuffix) } catch { return null }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return null
  const parts = fromFile.split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    if (part.includes(':')) return null
    parts.push(part)
  }
  return parts.join('/')
}

export function pathInsideDirectory(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}/`)
}

const DESTINATION = /!\[[^\]]*\]\(\s*(<[^>\r\n]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)|<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi

export function linkedDestinations(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(DESTINATION)) {
    const raw = match[1] || match[2] || match[3] || ''
    const destination = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1).trim() : raw.trim()
    if (destination) found.push(destination)
  }
  return found
}
