import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { DesktopApi, ImageStoragePublic, Result } from '../../../shared/contracts'
import { Button } from './ui'

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error)
  return result.data
}
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。'

export function ImageStorageSettings({ api }: { api: DesktopApi }) {
  const [stored, setStored] = useState<ImageStoragePublic | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [region, setRegion] = useState('')
  const [bucket, setBucket] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    void unwrap(api.getImageStorage()).then(next => {
      setStored(next); setEnabled(next.enabled); setEndpoint(next.endpoint); setRegion(next.region); setBucket(next.bucket); setPublicBaseUrl(next.publicBaseUrl)
    }).catch(cause => setError(message(cause)))
  }, [api])
  return <section className="settings-section" aria-label="图片存储"><div className="settings-section-title"><div><h2>图片存储</h2><p>未启用时，图片保存在文章同名目录。启用 S3/R2 后只上传并插入公开链接，不写本地副本。</p></div></div>
    <label className="image-storage-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用 S3/R2 上传</label>
    <div className="image-storage-fields">
      <label>服务地址<input className="input" value={endpoint} placeholder="https://account.r2.cloudflarestorage.com" onChange={event => setEndpoint(event.target.value)} /></label>
      <label>区域<input className="input" value={region} placeholder="auto" onChange={event => setRegion(event.target.value)} /></label>
      <label>存储桶<input className="input" value={bucket} onChange={event => setBucket(event.target.value)} /></label>
      <label>公开访问地址<input className="input" value={publicBaseUrl} placeholder="https://images.example.com" onChange={event => setPublicBaseUrl(event.target.value)} /></label>
      <label>访问密钥 ID<input className="input" value={accessKeyId} placeholder={stored?.accessKeyHint ? `留空保持 ${stored.accessKeyHint}` : ''} autoComplete="off" onChange={event => setAccessKeyId(event.target.value)} /></label>
      <label>秘密访问密钥<input className="input" type="password" value={secretAccessKey} placeholder={stored?.secretConfigured ? '已保存，留空保持不变' : ''} autoComplete="new-password" onChange={event => setSecretAccessKey(event.target.value)} /></label>
    </div>
    <div className="editor-config-actions"><Button size="small" disabled={busy} onClick={() => void (async () => {
      setBusy(true); setError(''); setStatus('')
      try {
        const next = await unwrap(api.setImageStorage({ enabled, endpoint, region, bucket, publicBaseUrl, accessKeyId, secretAccessKey }))
        setStored(next); setEnabled(next.enabled); setEndpoint(next.endpoint); setRegion(next.region); setBucket(next.bucket); setPublicBaseUrl(next.publicBaseUrl); setAccessKeyId(''); setSecretAccessKey('')
        setStatus(next.enabled ? '已启用上传。新图片不会再保存到文章目录。' : '已关闭上传。之后的图片保存到文章同名目录。')
      } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
    })()}>保存图片存储</Button></div>
    {error && <p className="settings-warning" role="alert"><AlertCircle size={15} />{error}</p>}
    {status && <p className="editor-config-status" role="status">{status}</p>}
  </section>
}
