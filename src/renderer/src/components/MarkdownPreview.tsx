import { useDeferredValue } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownBody } from '../editor/source-state'

export function MarkdownPreview({ source, mdx }: { source: string; mdx: boolean }) {
  const content = useDeferredValue(markdownBody(source))
  return <section className="markdown-preview" aria-label="文章预览">
    <p className="preview-note">{mdx ? 'MDX 基础预览：组件、import 和表达式不执行，完整效果需使用 Astro 本地站点。' : 'Markdown 基础预览：HTML 不执行，图片与站点样式以 Astro 本地站点为准。'}</p>
    <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ children, href }) => <span className="preview-link" title={href}>{children}</span>,
      img: ({ alt }) => <span className="preview-image">图片：{alt || '未设置说明'}</span>,
    }}>{content}</Markdown></div>
  </section>
}
