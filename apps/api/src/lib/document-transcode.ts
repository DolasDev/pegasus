import sharp from 'sharp'
import type { DocumentVariantKind } from '@pegasus/domain'

export type TranscodeResult = {
  buffer: Buffer
  width: number
  height: number
}

const VARIANT_MAX_EDGE: Record<DocumentVariantKind, number> = {
  THUMB: 400,
  WEB: 2000,
}

const JPEG_QUALITY: Record<DocumentVariantKind, number> = {
  THUMB: 70,
  WEB: 80,
}

const TRANSCODABLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/bmp',
])

const PDF_MIME = 'application/pdf'

export function isTranscodable(mimeType: string): boolean {
  return TRANSCODABLE_IMAGE_TYPES.has(mimeType) || mimeType === PDF_MIME
}

export async function transcodeImage(
  input: Buffer,
  variant: DocumentVariantKind,
): Promise<TranscodeResult> {
  const maxEdge = VARIANT_MAX_EDGE[variant]
  const quality = JPEG_QUALITY[variant]

  const result = await sharp(input)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  return {
    buffer: result.data,
    width: result.info.width,
    height: result.info.height,
  }
}

export async function transcodePdfFirstPage(
  input: Buffer,
  variant: DocumentVariantKind,
): Promise<TranscodeResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(input) }).promise

  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 2.0 })

  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(viewport.width, viewport.height)
  const ctx = canvas.getContext('2d')

  // pdfjs RenderParameters type requires `canvas` but the render call works
  // with just canvasContext + viewport on the server-side legacy build.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render as any)({
    canvasContext: ctx,
    viewport,
  }).promise

  const pngBuffer = Buffer.from(canvas.toBuffer('image/png'))
  await doc.destroy()

  return transcodeImage(pngBuffer, variant)
}
