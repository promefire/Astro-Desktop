import { describe, expect, it } from 'vitest'
import { markdownBody, sameMarkdown, splitMarkdownSource } from '../src/renderer/src/editor/source-state'

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

  it('keeps frontmatter bytes, comments and field order out of the body', () => {
    const source = '\uFEFF---\r\n# 注释\r\ntitle: 保留\r\nextra: keep\r\n---\r\n# 标题\r\n'
    const parts = splitMarkdownSource(source)
    expect(parts.frontmatter + parts.body).toBe(source)
    expect(parts.frontmatter).toContain('# 注释')
    expect(parts.frontmatter.indexOf('title:')).toBeLessThan(parts.frontmatter.indexOf('extra:'))
    expect(parts.body).toBe('# 标题\r\n')
    expect(sameMarkdown(parts.body, '# 标题\n')).toBe(true)
    expect(sameMarkdown(parts.body, '# 标题 \n')).toBe(false)
  })
})
