import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { link, open, unlink } from 'node:fs/promises'
import { ARTICLE_SIZE_LIMIT } from './paths'
import { ServiceError } from './errors'

export function exportInput(value: unknown): { source: string; suggestedName: string } {
  if (!value || typeof value !== 'object' || !('source' in value) || typeof value.source !== 'string' || value.source.includes('\0') || Buffer.byteLength(value.source) > ARTICLE_SIZE_LIMIT) throw new ServiceError('INVALID_EDITOR_INPUT', '副本内容无效或超过 4 MB。')
  const name = 'suggestedName' in value && typeof value.suggestedName === 'string' ? path.basename(value.suggestedName) : '恢复副本.md'
  return { source: value.source, suggestedName: name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100) || '恢复副本.md' }
}

/** destination is obtained exclusively from Electron's native save dialog. */
export async function writeEditorCopy(destination: string, source: string): Promise<void> {
  const temporary = path.join(path.dirname(destination), `.astro-desktop-${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(source, 'utf8'); await file.sync() } finally { await file.close() }
    await link(temporary, destination)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new ServiceError('COPY_EXISTS', '该文件已存在。请换一个副本名称，原文件没有被覆盖。')
    throw new ServiceError('COPY_FAILED', '副本写入失败，请检查目录权限、空间与硬链接支持。')
  } finally { await unlink(temporary).catch(() => undefined) }
}
