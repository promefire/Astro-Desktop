import path from 'node:path'
import { open, realpath, stat } from 'node:fs/promises'
import { ServiceError } from './errors'

export const ARTICLE_SIZE_LIMIT = 4 * 1024 * 1024

export function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function normalizedRelative(relative: string): string {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
    throw new ServiceError('INVALID_PATH', '文章路径必须是项目内的相对路径。')
  }
  const parts = relative.replaceAll('\\', '/').split('/')
  if (parts.some((part) => part === '..' || part === '.' || !part || part.includes(':'))) {
    throw new ServiceError('INVALID_PATH', '文章路径包含不允许的路径片段。')
  }
  return parts.join('/')
}

export async function safePath(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, normalizedRelative(relative))
  const resolved = await realpath(target)
  if (!isWithin(root, resolved)) throw new ServiceError('PATH_OUTSIDE_PROJECT', '路径或链接指向项目目录之外，已拒绝访问。')
  return resolved
}

export async function readBounded(filePath: string, limit: number): Promise<{ text: string; size: number; modifiedAt: string }> {
  const handle = await open(filePath, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new ServiceError('NOT_A_FILE', '所选路径不是普通文件。')
    if (info.size > limit) throw new ServiceError('FILE_TOO_LARGE', `文件超过读取限制（${Math.round(limit / 1024)} KB）。`)
    // Reading a bounded buffer also protects against a file growing after stat().
    const buffer = Buffer.alloc(limit + 1)
    let bytes = 0
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes)
      if (read.bytesRead === 0) break
      bytes += read.bytesRead
    }
    if (bytes > limit) throw new ServiceError('FILE_TOO_LARGE', '文件在读取时增长，超过大小限制。')
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytes)), size: bytes, modifiedAt: info.mtime.toISOString() }
  } finally {
    await handle.close()
  }
}

export async function ensureDirectory(root: string, relative: string): Promise<string> {
  const directory = await safePath(root, relative)
  if (!(await stat(directory)).isDirectory()) throw new ServiceError('INVALID_PROJECT', `${relative} 不是目录。`)
  return directory
}
