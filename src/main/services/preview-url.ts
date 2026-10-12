const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost)$/i

export function localOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || url.username || url.password || !LOCAL_HOST.test(url.hostname)) return null
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return null
    return url.origin
  } catch {
    return null
  }
}

export function latestLocalUrl(log: string): string | null {
  const matches = log.match(/http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?(?:\/[^\s<>"'`]*)?/gi) ?? []
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const candidate = matches[index].replace(/[),.;]+$/, '')
    if (!candidate.includes('@') && localOrigin(candidate)) return new URL(candidate).href
  }
  return null
}

export function joinLocalUrl(base: string, pathname: string): string | null {
  const origin = localOrigin(base)
  if (!origin || !pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) return null
  try {
    const url = new URL(pathname, `${origin}/`)
    if (url.origin !== origin || url.username || url.password || url.protocol !== 'http:') return null
    return url.href
  } catch {
    return null
  }
}
