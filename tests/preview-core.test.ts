import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createLogBuffer } from '../src/main/services/preview-log'
import { expandWindowsVars, npmDevCommand, parseRegistryValue, splitPath } from '../src/main/services/preview-env'
import { collectionId, dailyPath, hashSlug, pinyinSlug, postPath, readSlugMode } from '../src/main/services/preview-route'
import { joinLocalUrl, latestLocalUrl, localOrigin } from '../src/main/services/preview-url'

describe('preview log, address and route helpers', () => {
  it('bounds logs, joins chunks, strips ANSI and redacts tokens', () => {
    const log = createLogBuffer()
    log.push('\u001b[31mhel')
    log.push('lo\u001b[0m\n')
    log.push('npm_1234567890abcdef\n_authToken=secret value\n')
    log.push(`${'x'.repeat(2500)}\n`)
    expect(log.text()).toContain('hello')
    expect(log.text()).not.toContain('\u001b')
    expect(log.text()).toContain('[已隐藏令牌]')
    expect(log.text()).toContain('_authToken=[已隐藏]')
    expect(log.text()).toContain('行已截断')
    expect(log.text()).not.toContain('x'.repeat(2200))
    const flood = createLogBuffer()
    for (let index = 0; index < 400; index += 1) flood.push(`${String(index).padStart(4, '0')} ${'y'.repeat(1000)}\n`)
    expect(flood.text().length).toBeLessThan(210_000)
    expect(flood.text()).toContain('较早日志已截断')
    expect(flood.text()).not.toContain('0000 ')
  })

  it('accepts only the latest local http address', () => {
    const log = 'see http://evil.com/a http://user:pass@127.0.0.1:9/ http://127.0.0.1.evil.com/ then http://localhost:4321/ and http://127.0.0.1:4400/post'
    expect(latestLocalUrl(log)).toBe('http://127.0.0.1:4400/post')
    expect(localOrigin('javascript:alert(1)')).toBeNull()
    expect(localOrigin('file:///C:/Windows')).toBeNull()
    expect(localOrigin('http://evil.com/')).toBeNull()
    expect(joinLocalUrl('http://127.0.0.1:4400/', 'http://evil.com/')).toBeNull()
    expect(joinLocalUrl('http://127.0.0.1:4400/', '//evil.com')).toBeNull()
    expect(joinLocalUrl('http://127.0.0.1:4400/', '/ai-daily#daily-a')).toBe('http://127.0.0.1:4400/ai-daily#daily-a')
  })

  it('parses Windows PATH values and builds a quoted npm command', () => {
    expect(parseRegistryValue('HKEY_CURRENT_USER\\Environment\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;D:\\tools\n')).toBe('%SystemRoot%\\system32;D:\\tools')
    expect(parseRegistryValue('    Path    REG_SZ    (值未设置)\n')).toBeNull()
    expect(expandWindowsVars('%SystemRoot%\\system32;%MISSING%', { SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\system32;')
    expect(splitPath('C:\\A;C:\\a; ;D:\\B\\')).toEqual(['C:\\A', 'D:\\B'])
    expect(npmDevCommand('F:\\中文 工具\\npm.cmd')).toBe('""F:\\中文 工具\\npm.cmd" run dev"')
    expect(() => npmDevCommand('F:\\tools\\npm.cmd & calc')).toThrow(/npm\.cmd/)
  })

  it('follows the blog slug rules without inventing an unknown mode', () => {
    expect(collectionId('src/contents/post/目录/文章.md', 'post')).toBe('目录/文章')
    expect(collectionId('src/contents/ai-daily/2026-10-08.md', 'ai-daily')).toBe('2026-10-08')
    expect(collectionId('src/contents/drafts/note.md', 'draft')).toBeNull()
    expect(readSlugMode('export default { slugMode: "PINYIN", title: "x" }')).toBe('PINYIN')
    expect(readSlugMode('slugMode: "RAW"\nslugMode: "HASH"')).toBeNull()
    expect(hashSlug('hello')).toBe(createHash('sha256').update('hello').digest('hex').slice(0, 8))
    expect(hashSlug('hello')).toBe('2cf24dba')
    expect(postPath('Hello World', 'RAW', () => [])).toBe('/post/Hello%20World')
    expect(postPath('目录/文章', 'PINYIN', (segment) => segment === '目录' ? ['mu', 'lu'] : ['wen', 'zhang'])).toBe('/post/mu-lu-wen-zhang')
    expect(pinyinSlug('Hello World', () => [])).toBe('hello-world')
    expect(dailyPath('2026/10/08')).toBe('/ai-daily#daily-2026-10-08')
  })
})
