import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { compressWebp } from '../src/main/services/image-processing'

describe('real WebP compression', () => {
  it('compresses a PNG, retaining dimensions and alpha', async () => {
    const original = await sharp({ create: { width: 800, height: 600, channels: 4, background: '#3894aa80' } }).png().toBuffer()
    const output = await compressWebp(original)
    expect(await sharp(output).metadata()).toMatchObject({ format: 'webp', width: 800, height: 600, hasAlpha: true })
    expect(output.length).toBeLessThan(original.length)
  })
  it('honors JPEG orientation and strips EXIF', async () => {
    const original = await sharp({ create: { width: 20, height: 10, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const metadata = await sharp(await compressWebp(original)).metadata()
    expect(metadata).toMatchObject({ format: 'webp', width: 10, height: 20 })
    expect(metadata.exif).toBeUndefined()
  })
  it('retains animated GIF frames and timing', async () => {
    const bytes = Buffer.concat([Buffer.alloc(16 * 16 * 3, 0), Buffer.alloc(16 * 16 * 3, 255)])
    const gif = await sharp(bytes, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).gif({ delay: [100, 200], loop: 2 }).toBuffer()
    expect(await sharp(await compressWebp(gif), { animated: true }).metadata()).toMatchObject({ format: 'webp', pages: 2, delay: [100, 200], loop: 2 })
  })
  it('rejects non-images, SVG and oversized data without producing disguised files', async () => {
    for (const bytes of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), Buffer.alloc(8 * 1024 * 1024 + 1)]) {
      await expect(compressWebp(bytes)).rejects.toThrow()
    }
  })
})
