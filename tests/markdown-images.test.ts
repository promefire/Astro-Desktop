import { describe, expect, it } from 'vitest'
import { imageUrlKey, markdownImages, replaceMarkdownImages } from '../src/shared/markdown-images'

describe('pasted Markdown images', () => {
  it('finds inline and reference images, preserving titles and unrelated text', () => {
    const source = '正文\r\n![图](https://cdn.example/a(b).png#width=100 "标题")\r\n![另一图][shot]\r\n[普通链接][shot]\r\n\r\n[shot]: https://cdn.example/a(b).png "引用标题"\r\n'
    const images = markdownImages(source)
    expect(images).toHaveLength(2)
    expect(images.map(image => imageUrlKey(image.url))).toEqual(['https://cdn.example/a(b).png', 'https://cdn.example/a(b).png'])
    const next = replaceMarkdownImages(source, images, new Map([['https://cdn.example/a(b).png', 'https://img.example/one.webp']]))
    expect(next).toContain('![图](<https://img.example/one.webp> "标题")')
    expect(next).toContain('![另一图](<https://img.example/one.webp> "引用标题")')
    expect(next).toContain('[普通链接][shot]\r\n\r\n[shot]: https://cdn.example/a(b).png "引用标题"')
    expect(next.startsWith('正文\r\n')).toBe(true)
  })
  it('ignores frontmatter, fenced/inline code, comments, plain links, and local images', () => {
    const image = '![x](https://cdn.example/x.png)'
    const source = `---\nsummary: '${image}'\n---\n\n\`${image}\`\n\n\`\`\`md\n${image}\n\`\`\`\n\n<!-- <img src="https://cdn.example/x.png"> -->\n\n[link](https://cdn.example/x.png)\n![local](./one.png)\n`
    expect(markdownImages(source)).toEqual([])
  })
  it('supports HTML image src, escaped alt text and URLs with query parameters', () => {
    const source = '![a\\[b\\]](<https://cdn.example/a.png?a=1&b=2>)\n\n<img width="42" src="https://cdn.example/a.png?a=1&amp;b=2" alt="图" />'
    const images = markdownImages(source)
    expect(images).toHaveLength(2)
    expect(images[0].url).toBe(images[1].url)
    const next = replaceMarkdownImages(source, images, new Map([[images[0].url, 'https://img.example/test.webp']]))
    expect(next).toContain('![a\\[b\\]](<https://img.example/test.webp>)')
    expect(next).toContain('<img width="42" src="https://img.example/test.webp" alt="图" />')
  })
  it('only replaces successful images; failed original links stay byte-for-byte intact', () => {
    const source = '![ok](https://cdn.example/a.png)\n![bad](https://cdn.example/b.png "keep me")'
    expect(replaceMarkdownImages(source, markdownImages(source), new Map([['https://cdn.example/a.png', './文章/a.webp']]))).toBe('![ok](<./文章/a.webp>)\n![bad](https://cdn.example/b.png "keep me")')
  })
})
