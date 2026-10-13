import { lookup } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import ipaddr from 'ipaddr.js'
import { IMAGE_LIMIT, importArticleImage } from './images'
import { ServiceError } from './errors'
import { objectKey, type ImageStorage } from './image-storage'
import type { ProjectInfo } from '../../shared/contracts'

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}
export function remoteImageUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new ServiceError('INVALID_IMAGE_URL', '图片链接格式无效。') }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (value.length > 8192 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || host === 'localhost' || (ipaddr.isValid(host) && !isPublicAddress(host))) {
    throw new ServiceError('INVALID_IMAGE_URL', '只支持公开的 HTTP/HTTPS 图片链接，不访问本机或内网地址。')
  }
  url.hash = ''
  return url
}

/** Public network only, including each redirect and the actual DNS lookup used by the socket. */
export async function downloadRemoteImage(value: string, signal = AbortSignal.timeout(20_000), redirects = 0): Promise<Buffer> {
  const url = remoteImageUrl(value)
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'user-agent': 'AstroDesktop/0.1' },
      // Validate inside socket lookup so a second DNS resolution cannot bypass validation.
      lookup(host, options, callback) {
        lookup(host, { all: true }, (error, addresses) => {
          if (error) { callback(error, '', 4); return }
          if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
            callback(new Error('图片域名指向本机或内网地址，已停止下载。'), '', 4); return
          }
          if (options.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        })
      },
    }, response => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy()
        if (!response.headers.location || redirects >= 3) { reject(new Error('图片重定向过多或地址缺失。')); return }
        let next: URL
        try { next = remoteImageUrl(new URL(response.headers.location, url).href) } catch (error) { reject(error); return }
        if (url.protocol === 'https:' && next.protocol !== 'https:') { reject(new Error('图片重定向降级为 HTTP，已停止下载。')); return }
        downloadRemoteImage(next.href, signal, redirects + 1).then(resolve, reject)
        return
      }
      if (status !== 200) { response.destroy(); reject(new Error(`图片下载失败（HTTP ${status}）；可能需要登录或来源站限制了访问。`)); return }
      const type = response.headers['content-type']?.split(';')[0].trim().toLowerCase()
      if (!type || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/octet-stream'].includes(type)) {
        response.destroy(); reject(new Error('链接未返回支持的图片，可能是登录页面或已过期。')); return
      }
      if (Number(response.headers['content-length']) > IMAGE_LIMIT) { response.destroy(); reject(new Error('远程图片超过 8 MB。')); return }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > IMAGE_LIMIT) { response.destroy(new Error('远程图片超过 8 MB。')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('图片下载中断。')))
    })
    request.on('error', reject)
    request.end()
  })
}

export async function importRemoteImage(project: ProjectInfo, articlePath: string, value: string, storage: ImageStorage, download = downloadRemoteImage, fetchImpl?: typeof fetch): Promise<{ destination: string; storage: 'local' | 'remote'; skipped: boolean }> {
  const url = remoteImageUrl(value)
  if (storage.enabled) {
    const base = new URL(`${storage.publicBaseUrl}/astro-desktop/`)
    if (url.origin === base.origin && url.pathname.startsWith(base.pathname) && /\.webp$/i.test(url.pathname)) return { destination: value, storage: 'remote', skipped: true }
  }
  let bytes: Buffer
  try { bytes = await download(url.href) } catch (error) {
    // Network exceptions can contain signed query parameters. Only expose our fixed diagnostics.
    const reason = error instanceof Error && /^(图片|远程图片|链接|只支持)/.test(error.message) ? error.message : '网络不可用或下载超时。'
    throw new ServiceError('IMAGE_DOWNLOAD_FAILED', reason)
  }
  const result = await importArticleImage(project, articlePath, objectKey('image.png').split('/').at(-1)!, bytes, '图片', storage, fetchImpl)
  return { destination: result.markdown.slice(result.markdown.indexOf('](') + 2, -1), storage: result.storage, skipped: false }
}
