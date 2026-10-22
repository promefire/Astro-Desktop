import { describe, expect, it } from 'vitest'
import { updateFrontmatter, type MetadataValues } from '../src/renderer/src/editor/frontmatter'

const values: MetadataValues = {
  title: '新标题', published: '2026-10-22', category: '技术', tags: ['Astro', '桌面'], description: '新的摘要',
  summary: '', highlights: [], tools: [], top: '2', cover: '/cover.png', author: '作者', sourceLink: '', licenseName: '', licenseUrl: '',
}

describe('visual frontmatter editing', () => {
  it('updates supported fields, removes draft, and preserves unknown fields and comments', () => {
    const source = '\uFEFF---\r\n# keep this comment\r\ntitle: 旧标题\r\npublished: 2026-01-01\r\ndraft: true\r\nlegacy: keep\r\ntags: [旧]\r\n---\r\n\r\n正文\r\n'
    const next = updateFrontmatter(source.slice(0, source.indexOf('---\r\n\r\n正文') + 7), 'post', values)
    expect(next).toContain('# keep this comment')
    expect(next).toContain('legacy: keep')
    expect(next).not.toMatch(/draft\s*:/)
    expect(next).toContain('title: 新标题')
    expect(next).toContain('category: 技术')
    expect(next).toContain('top: 2')
  })

  it('deletes empty optional fields without changing the body boundary', () => {
    const source = '---\ntitle: 标题\npublished: 2026-01-01\ncategory: 旧\ndescription: 旧\ntop: 3\n---\n\n正文\n'
    const empty = { ...values, category: '', description: '', top: '', cover: '', author: '' }
    const next = updateFrontmatter(source.slice(0, source.indexOf('---\n\n正文') + 7), 'draft', empty)
    expect(next).not.toContain('category:')
    expect(next).not.toContain('description:')
    expect(next).not.toContain('top:')
    expect(next).toContain('---\n\n')
  })
})
