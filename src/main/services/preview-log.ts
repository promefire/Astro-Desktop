const MAX_LOG_CHARS = 200_000
const MAX_LINE_CHARS = 2_000

export function stripAnsi(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u001b\u009b][@-_]/g, '')
}

export function redactSecrets(value: string): string {
  return value
    .replace(/(_authToken=)\S+/gi, '$1[已隐藏]')
    .replace(/\bnpm_[A-Za-z0-9]{8,}\b/g, '[已隐藏令牌]')
}

export function createLogBuffer() {
  let text = ''
  let pending = ''
  const append = (line: string) => {
    const limited = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…（行已截断）` : line
    text += `${limited}\n`
    if (Buffer.byteLength(text) <= MAX_LOG_CHARS && text.length <= MAX_LOG_CHARS) return
    text = text.slice(Math.max(0, text.length - MAX_LOG_CHARS))
    const breakAt = text.indexOf('\n')
    text = `……（较早日志已截断）\n${breakAt >= 0 ? text.slice(breakAt + 1) : text}`
  }
  return {
    push(chunk: string) {
      pending += redactSecrets(stripAnsi(chunk).replace(/\0/g, ''))
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) append(line)
    },
    flush() {
      if (!pending) return
      append(pending)
      pending = ''
    },
    clear() { text = ''; pending = '' },
    text() { return pending ? `${text}${pending}` : text },
  }
}
