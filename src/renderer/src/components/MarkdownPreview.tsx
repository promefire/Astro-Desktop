import { useDeferredValue, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DesktopApi, Result } from '../../../shared/contracts'
import { markdownBody } from '../editor/source-state'

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function PreviewImage({ alt, src, api, projectPath, relativePath }: { alt?: string; src?: string; api: DesktopApi; projectPath: string; relativePath: string }) {
  const remote = !!src && /^https:\/\//i.test(src)
  const [url, setUrl] = useState<string | null>(remote ? src! : null)
  useEffect(() => {
    if (!src || remote || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) { setUrl(remote ? src! : null); return }
    let cancelled = false
    void unwrap(api.readPreviewImage({ projectPath, relativePath, destination: src })).then(data => { if (!cancelled) setUrl(data) }).catch(() => { if (!cancelled) setUrl(null) })
    return () => { cancelled = true }
  }, [api, projectPath, relativePath, remote, src])
  if (!url) return <span className="preview-image">图片：{alt || '未设置说明'}</span>
  return <img src={url} alt={alt || ''} />
}

export function MarkdownPreview({ source, mdx, api, projectPath, relativePath }: { source: string; mdx: boolean; api: DesktopApi; projectPath: string; relativePath: string }) {
  const content = useDeferredValue(markdownBody(source))
  return <section className="markdown-preview" aria-label="文章预览">
    <p className="preview-note">{mdx ? 'MDX 基础预览：组件、import 和表达式不执行。本地图片和 https 图片会显示；完整站点效果仍使用 Astro 本地站点。' : 'Markdown 基础预览：HTML 不执行。本地图片读取文章所在内容目录，https 图片直接显示。'}</p>
    <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ children, href }) => <span className="preview-link" title={href}>{children}</span>,
      img: ({ alt, src }) => <PreviewImage alt={alt} src={src} api={api} projectPath={projectPath} relativePath={relativePath} />,
    }}>{content}</Markdown></div>
  </section>
}
