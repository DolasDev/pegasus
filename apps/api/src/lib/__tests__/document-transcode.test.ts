import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isTranscodable, transcodeImage } from '../document-transcode'

describe('isTranscodable', () => {
  it.each([
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/webp',
    'image/gif',
    'image/tiff',
    'image/avif',
    'image/bmp',
    'application/pdf',
  ])('returns true for %s', (mime) => {
    expect(isTranscodable(mime)).toBe(true)
  })

  it.each([
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'video/mp4',
  ])('returns false for %s', (mime) => {
    expect(isTranscodable(mime)).toBe(false)
  })
})

describe('transcodeImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resizes to fit within THUMB max edge (400px)', async () => {
    const sharp = await import('sharp')
    const input = await sharp
      .default({
        create: { width: 1000, height: 800, channels: 3, background: { r: 128, g: 128, b: 128 } },
      })
      .jpeg()
      .toBuffer()

    const result = await transcodeImage(input, 'THUMB')

    expect(result.width).toBeLessThanOrEqual(400)
    expect(result.height).toBeLessThanOrEqual(400)
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('resizes to fit within WEB max edge (2000px)', async () => {
    const sharp = await import('sharp')
    const input = await sharp
      .default({
        create: { width: 4000, height: 3000, channels: 3, background: { r: 128, g: 128, b: 128 } },
      })
      .jpeg()
      .toBuffer()

    const result = await transcodeImage(input, 'WEB')

    expect(result.width).toBeLessThanOrEqual(2000)
    expect(result.height).toBeLessThanOrEqual(2000)
    expect(result.buffer.length).toBeGreaterThan(0)
  })

  it('does not enlarge images smaller than the target', async () => {
    const sharp = await import('sharp')
    const input = await sharp
      .default({
        create: { width: 200, height: 150, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
      .jpeg()
      .toBuffer()

    const result = await transcodeImage(input, 'THUMB')

    expect(result.width).toBe(200)
    expect(result.height).toBe(150)
  })
})
