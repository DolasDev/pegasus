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
  // pdfjs 6 builds fill/stroke geometry as `Path2D` and hands it to the 2D
  // context. Node has no global Path2D, and the one @napi-rs/canvas exports is
  // only reachable via its module — so without this the native `fill()` rejects
  // the argument ("Value is none of these types `String`, `Path`") and every
  // PDF render throws. pdfjs 5 built paths inline and never needed them.
  const canvasLib = await import('@napi-rs/canvas')
  for (const name of ['Path2D', 'DOMMatrix', 'ImageData'] as const) {
    const g = globalThis as unknown as Record<string, unknown>
    if (g[name] === undefined && canvasLib[name] !== undefined) g[name] = canvasLib[name]
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // Hold the loading task: pdfjs 6 dropped `PDFDocumentProxy.destroy()`, so
  // teardown (which frees the worker) now goes through the task itself.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(input) })
  const doc = await loadingTask.promise

  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 2.0 })

  const { createCanvas } = canvasLib
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
  await loadingTask.destroy()

  return transcodeImage(pngBuffer, variant)
}
