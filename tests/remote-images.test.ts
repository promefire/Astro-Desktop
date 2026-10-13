import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { downloadRemoteImage, importRemoteImage, isPublicAddress, remoteImageUrl } from '../src/main/services/remote-images'
import type { ImageStorage } from '../src/main/services/image-storage'
import type { ProjectInfo } from '../src/shared/contracts'

const storage: ImageStorage = { enabled: true, endpoint: 'https://r2.example.com', region: 'auto', bucket: 'test-images', publicBaseUrl: 'https://img.example.com', accessKeyId: 'test-id', secretAccessKey: 'test-secret' }
const project = { path: 'unused-for-remote' } as ProjectInfo

describe('remote image import', () => {
  it('downloads, really converts, uploads and returns a flat WebP URL', async () => {
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: 'blue' } }).png().toBuffer()
    const download = vi.fn(async () => png)
    const upload = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('content-type')).toBe('image/webp')
      expect(await sharp(Buffer.from(init?.body as Uint8Array)).metadata()).toMatchObject({ format: 'webp', width: 64, height: 32 })
      return new Response(null, { status: 200 })
    })
    const result = await importRemoteImage(project, 'src/contents/drafts/test.md', 'https://cdn.example.com/yuque.png#width=64', storage, download, upload)
    expect(download).toHaveBeenCalledWith('https://cdn.example.com/yuque.png')
    expect(result).toMatchObject({ storage: 'remote', skipped: false })
    expect(result.destination).toMatch(/^https:\/\/img.example.com\/astro-desktop\/\d{8}_\d{6}_[a-z0-9]{6}\.webp$/)
    expect(upload).toHaveBeenCalledTimes(1)
  })
  it('skips existing WebP objects only on the configured public prefix', async () => {
    const download = vi.fn(async () => Buffer.from('invalid'))
    const result = await importRemoteImage(project, 'src/contents/post/test.md', 'https://img.example.com/astro-desktop/old.webp', storage, download)
    expect(result.skipped).toBe(true)
    expect(download).not.toHaveBeenCalled()
    await expect(importRemoteImage(project, 'src/contents/post/test.md', 'https://img.example.com.evil.example/astro-desktop/old.webp', storage, download)).rejects.toMatchObject({ code: 'IMAGE_CONVERSION_FAILED' })
    expect(download).toHaveBeenCalledTimes(1)
  })
  it('does not upload invalid content or reveal signed URLs in errors', async () => {
    const upload = vi.fn<typeof fetch>()
    await expect(importRemoteImage(project, 'src/contents/drafts/test.md', 'https://cdn.example.com/a?token=private', storage, async () => { throw new Error('failed https://cdn.example.com/a?token=private') }, upload)).rejects.toThrow('网络不可用或下载超时')
    await expect(importRemoteImage(project, 'src/contents/drafts/test.md', 'https://cdn.example.com/a', storage, async () => Buffer.from('<html>Login</html>'), upload)).rejects.toMatchObject({ code: 'IMAGE_CONVERSION_FAILED' })
    expect(upload).not.toHaveBeenCalled()
  })
  it('rejects failed uploads without a replacement destination', async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
    await expect(importRemoteImage(project, 'src/contents/drafts/test.md', 'https://cdn.example.com/a', storage, async () => png, async () => new Response(null, { status: 403 }))).rejects.toMatchObject({ code: 'IMAGE_UPLOAD_FAILED' })
  })
})

describe('remote download boundaries', () => {
  it('rejects credentials, unsupported ports/protocols and private addresses', async () => {
    for (const url of ['file:///a.png', 'ftp://example.com/a', 'https://user:pass@example.com/a', 'http://localhost/a', 'http://127.0.0.1/a', 'http://2130706433/a', 'http://169.254.169.254/a', 'http://[::1]/a', 'http://[::ffff:127.0.0.1]/a', 'https://example.com:8443/a']) {
      expect(() => remoteImageUrl(url)).toThrow()
      await expect(downloadRemoteImage(url)).rejects.toThrow()
    }
    for (const address of ['10.1.2.3', '172.16.2.1', '192.168.1.1', '0.0.0.0', '224.0.0.1', '100.64.0.1', 'fc00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })
  it('checks actual DNS lookup results before opening a socket', async () => {
    // localhost with a trailing dot passes URL syntax validation, then resolves locally.
    await expect(downloadRemoteImage('http://localhost./image.png', AbortSignal.timeout(2000))).rejects.toThrow(/内网/)
  })
})
