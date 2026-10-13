import sharp from 'sharp'
import { ServiceError } from './errors'

const PIXEL_LIMIT = 40_000_000
const BYTE_LIMIT = 8 * 1024 * 1024

/** Decode actual image bytes; never treat changing the extension as conversion. */
export async function compressWebp(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > BYTE_LIMIT) throw new ServiceError('INVALID_IMAGE', '图片为空或超过 8 MB。')
  try {
    const image = sharp(bytes, { animated: true, limitInputPixels: PIXEL_LIMIT })
    const metadata = await image.metadata()
    if (!['png', 'jpeg', 'gif', 'webp', 'avif', 'heif'].includes(metadata.format ?? '')) throw new Error('Unsupported format')
    // Animated input is decoded as all frames; do not silently flatten GIF/WebP.
    if ((metadata.pages ?? 1) === 1) image.autoOrient()
    const output = await image.webp({ quality: 80, alphaQuality: 100, effort: 4 }).timeout({ seconds: 20 }).toBuffer()
    if (output.length > BYTE_LIMIT) throw new Error('Output too large')
    return output
  } catch {
    throw new ServiceError('IMAGE_CONVERSION_FAILED', '图片无法转换为 WebP：文件可能损坏、格式不支持或超过处理限制（总像素 4000 万、输出 8 MB）。原文件未修改。')
  }
}
