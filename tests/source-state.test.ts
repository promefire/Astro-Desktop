import { describe, expect, it } from 'vitest'
import { markdownBody } from '../src/renderer/src/editor/source-state'

describe('Markdown body extraction', () => {
  it('extracts body after frontmatter and strips BOM', () => {
    expect(markdownBody('\uFEFF---\r\ntitle: 测试\r\n---\r\n# 正文')).toBe('# 正文')
    expect(markdownBody('---\ntitle: 未关闭')).toBe('')
    expect(markdownBody('# 普通文本')).toBe('# 普通文本')
  })

  it('handles mixed line endings and preserves body content exactly', () => {
    expect(markdownBody('---\ntitle: 测试\n---\n第一行\r\n第二行\n')).toBe('第一行\r\n第二行\n')
    expect(markdownBody('---\r\ntitle: 测试\r\n---\r\n只有LF\n')).toBe('只有LF\n')
  })

  it('returns empty when frontmatter is not closed and body when no frontmatter', () => {
    expect(markdownBody('---\ntitle: 未闭合')).toBe('')
    expect(markdownBody('普通内容')).toBe('普通内容')
    expect(markdownBody('\uFEFF普通内容BOM')).toBe('普通内容BOM')
  })
})
