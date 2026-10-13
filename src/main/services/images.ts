import path from 'node:path'
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import type { ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, contentKind } from '../adapters/promefire'
import { assetDirectory, imageMarkdown, localImageDestination, resolveMarkdownPath } from '../../shared/image-path'
import { ServiceError, isMissing } from './errors'
import { isWithin, normalizedRelative, safePath } from './paths'
import { objectKey, putObject, type ImageStorage } from './image-storage'

export const IMAGE_LIMIT = 8 * 1024 * 1024
const TYPES = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.avif', 'image/avif']])

export function imageFileName(original: string): { name: string; contentType: string } {
  const base = path.basename(original).normalize('NFKC')
  const extension = path.extname(base).toLowerCase()
  const contentType = TYPES.get(extension)
  if (!contentType) throw new ServiceError('INVALID_IMAGE', '只接受 PNG、JPEG、GIF、WebP 或 AVIF 图片。')
  let stem = Array.from(base.slice(0, -extension.length).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')).slice(0, 80).join('').replace(/^[ .]+|[ .]+$/g, '')
  if (!stem || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = 'image'
  return { name: `${stem}${extension}`, contentType }
}

export function imageBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > IMAGE_LIMIT) {
    throw new ServiceError('INVALID_IMAGE', '图片为空或超过 8 MB。')
  }
  return Buffer.from(value)
}

async function writableAssetDirectory(project: ProjectInfo, relativeDirectory: string): Promise<string> {
  if (await realpath(project.path) !== project.path) throw new ServiceError('PROJECT_PATH_CHANGED', '项目路径已改变，请重新选择目录。')
  const parts = relativeDirectory.split('/')
  let directory = project.path
  for (let index = 0; index < parts.length; index += 1) {
    directory = path.join(directory, parts[index])
    let info
    try { info = await lstat(directory) } catch (error) {
      if (isMissing(error) && index !== parts.length - 1) throw new ServiceError('UNSAFE_WRITE_PATH', '文章所在目录不存在，没有创建图片目录。')
      if (!isMissing(error) || index !== parts.length - 1) throw error
      await mkdir(directory)
      info = await lstat(directory)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new ServiceError('UNSAFE_WRITE_PATH', '图片目录包含链接或不是实际目录，已拒绝写入。')
    if (path.relative(directory, await realpath(directory))) throw new ServiceError('UNSAFE_WRITE_PATH', '图片目录指向其他位置，已拒绝写入。')
  }
  return directory
}

async function unusedName(directory: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName)
  const stem = path.basename(fileName, extension)
  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    const name = suffix === 1 ? fileName : `${stem}-${suffix}${extension}`
    try { await lstat(path.join(directory, name)) } catch (error) {
      if (isMissing(error)) return name
      throw error
    }
  }
  throw new ServiceError('NAME_CONFLICT', '同名图片过多，请更换文件名。')
}

export async function importArticleImage(project: ProjectInfo, articlePath: string, originalName: string, bytes: Buffer, alt: string, storage: ImageStorage, fetchImpl?: typeof fetch): Promise<{ markdown: string; storage: 'local' | 'remote' }> {
  const relativePath = normalizedRelative(articlePath)
  const kind = contentKind(relativePath)
  if (!kind || kind === 'ai-daily') throw new ServiceError('UNSUPPORTED_CONTENT', '图片只导入到正文或草稿文章旁边。')
  const file = imageFileName(originalName)
  if (storage.enabled) {
    const key = objectKey(project.path, relativePath, file.name)
    const destination = await putObject(storage, key, bytes, file.contentType, fetchImpl)
    return { markdown: imageMarkdown(alt, destination), storage: 'remote' }
  }
  const directory = await writableAssetDirectory(project, assetDirectory(relativePath))
  const name = await unusedName(directory, file.name)
  const target = path.join(directory, name)
  const handle = await open(target, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(target).catch(() => undefined)
    throw error
  }
  await handle.close()
  return { markdown: imageMarkdown(alt, localImageDestination(relativePath, name)), storage: 'local' }
}

export async function readPreviewImage(project: ProjectInfo, articlePath: string, destination: string): Promise<string | null> {
  const article = normalizedRelative(articlePath)
  const kind = contentKind(article)
  const relative = resolveMarkdownPath(article, destination)
  if (!relative || !kind) return null
  const contentType = TYPES.get(path.extname(relative).toLowerCase())
  if (!contentType) return null
  try {
    const file = await safePath(project.path, relative)
    const collection = await safePath(project.path, CONTENT_DIRECTORIES[kind])
    if (!isWithin(collection, file)) return null
    const info = await lstat(file)
    if (info.isSymbolicLink() || !info.isFile() || info.size > IMAGE_LIMIT) return null
    const handle = await open(file, 'r')
    try {
      const data = Buffer.alloc(info.size)
      await handle.read(data, 0, data.length, 0)
      return `data:${contentType};base64,${data.toString('base64')}`
    } finally { await handle.close() }
  } catch { return null }
}
