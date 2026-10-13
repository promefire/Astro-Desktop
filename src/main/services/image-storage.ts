import { createHash, createHmac } from 'node:crypto'
import path from 'node:path'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ServiceError, errorMessage, isMissing } from './errors'
import { readBounded } from './paths'

export interface ImageStorage {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  publicBaseUrl: string
  accessKeyId: string
  secretAccessKey: string
}
export interface ImageStoragePublic {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  publicBaseUrl: string
  accessKeyHint: string
  secretConfigured: boolean
}

const EMPTY: ImageStorage = { enabled: false, endpoint: '', region: '', bucket: '', publicBaseUrl: '', accessKeyId: '', secretAccessKey: '' }
const TEXT = /^[\x21-\x7e]{1,256}$/
const URL_TEXT = /^https:\/\/[^\s?#]{1,300}$/

export function toPublic(storage: ImageStorage): ImageStoragePublic {
  const hint = storage.accessKeyId.length > 4 ? `····${storage.accessKeyId.slice(-4)}` : ''
  return {
    enabled: storage.enabled, endpoint: storage.endpoint, region: storage.region, bucket: storage.bucket,
    publicBaseUrl: storage.publicBaseUrl, accessKeyHint: hint, secretConfigured: storage.secretAccessKey.length > 0,
  }
}

export function normalizeImageStorage(value: unknown, previous: ImageStorage = EMPTY): ImageStorage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('INVALID_IMAGE_STORAGE', '图片存储设置无效。')
  const input = value as Record<string, unknown>
  const allowed = ['enabled', 'endpoint', 'region', 'bucket', 'publicBaseUrl', 'accessKeyId', 'secretAccessKey']
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new ServiceError('INVALID_IMAGE_STORAGE', '图片存储设置包含不支持的字段。')
  const enabled = input.enabled === true
  const text = (key: string, pattern: RegExp) => {
    const field = input[key]
    if (typeof field !== 'string' || (field && !pattern.test(field.trim()))) throw new ServiceError('INVALID_IMAGE_STORAGE', `${key} 格式无效。`)
    return field.trim().replace(/\/+$/, '')
  }
  const endpoint = text('endpoint', URL_TEXT)
  const publicBaseUrl = text('publicBaseUrl', URL_TEXT)
  const region = text('region', TEXT)
  const bucket = text('bucket', /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
  const accessKeyId = typeof input.accessKeyId === 'string' && input.accessKeyId.trim() ? text('accessKeyId', TEXT) : previous.accessKeyId
  const secretAccessKey = typeof input.secretAccessKey === 'string' && input.secretAccessKey ? text('secretAccessKey', TEXT) : previous.secretAccessKey
  if (enabled && (!endpoint || !region || !bucket || !publicBaseUrl || !accessKeyId || !secretAccessKey)) {
    throw new ServiceError('INVALID_IMAGE_STORAGE', '启用 S3/R2 时需要填写地址、区域、存储桶、公开访问地址和凭据。')
  }
  return { enabled, endpoint, region, bucket, publicBaseUrl, accessKeyId, secretAccessKey }
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}
function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

export function signingKey(secret: string, date: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request')
}

export async function putObject(storage: ImageStorage, key: string, body: Buffer, contentType: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!storage.enabled) throw new ServiceError('IMAGE_STORAGE_DISABLED', 'S3/R2 未启用。')
  const endpoint = new URL(storage.endpoint)
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const canonicalUri = `/${storage.bucket}/${encodedKey}`
  const payloadHash = sha256Hex(body)
  const host = endpoint.host
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonical = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${date}/${storage.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n')
  const signature = createHmac('sha256', signingKey(storage.secretAccessKey, date, storage.region)).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${storage.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  let response: Response
  try {
    response = await fetchImpl(new URL(canonicalUri, endpoint), {
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, authorization },
      body: new Uint8Array(body),
    })
  } catch (error) {
    throw new ServiceError('IMAGE_UPLOAD_FAILED', `图片上传失败，没有插入链接，也没有保存本地副本：${redact(errorMessage(error), storage)}`)
  }
  if (!response.ok) throw new ServiceError('IMAGE_UPLOAD_FAILED', `图片上传被拒绝（HTTP ${response.status}）。没有插入链接，也没有保存本地副本。`)
  return `${storage.publicBaseUrl}/${encodedKey}`
}

function redact(message: string, storage: ImageStorage): string {
  return [storage.secretAccessKey, storage.accessKeyId].filter(Boolean).reduce((text, secret) => text.split(secret).join('***'), message)
}

export function objectKey(projectPath: string, articlePath: string, fileName: string): string {
  const project = createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
  const article = createHash('sha256').update(articlePath).digest('hex').slice(0, 12)
  return `astro-desktop/${project}/${article}/${fileName}`
}

export function createImageStorageService(file: string) {
  let current: ImageStorage | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }
  async function load(): Promise<ImageStorage> {
    if (current) return current
    try { return current = normalizeImageStorage(JSON.parse((await readBounded(file, 16 * 1024)).text)) }
    catch (error) {
      if (isMissing(error)) return current = { ...EMPTY }
      throw new ServiceError('IMAGE_STORAGE_CORRUPT', '图片存储设置无法读取，原文件已保留。')
    }
  }
  async function persist(next: ImageStorage): Promise<ImageStorage> {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(next), 'utf8'); await handle.sync() } finally { await handle.close() }
      await rename(temporary, file)
      current = next
      return next
    } catch {
      await unlink(temporary).catch(() => undefined)
      throw new ServiceError('IMAGE_STORAGE_WRITE_FAILED', '图片存储设置保存失败。')
    }
  }
  return {
    get: () => serial(async () => toPublic(await load())),
    secret: () => serial(load),
    update: (value: unknown) => serial(async () => toPublic(await persist(normalizeImageStorage(value, await load())))),
  }
}
