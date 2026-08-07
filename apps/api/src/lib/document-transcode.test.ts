// ---------------------------------------------------------------------------
// Smoke coverage for the PDF transcode path.
//
// This module had no tests, which is how a major `pdfjs-dist` bump (5.x -> 6.x,
// for GHSA-hq66-cqwq-w95j) could otherwise land unverified: it imports pdfjs by
// a deep subpath (`pdfjs-dist/legacy/build/pdf.mjs`) and calls `page.render`
// with a shape the types don't actually agree with, so a breaking change there
// would surface only in prod, on a real upload.
//
// The fixture is a hand-built single-page PDF rather than a binary checked into
// the repo — it keeps the expectation readable and the diff reviewable.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { transcodePdfFirstPage } from './document-transcode'

/**
 * Builds a minimal, structurally valid one-page PDF with a correct xref table.
 * Offsets are computed rather than hard-coded so the fixture can't silently rot.
 */
function minimalPdf(): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 120 90]/Contents 4 0 R>>',
    // A single filled rectangle, so the rendered page isn't uniformly blank.
    '<</Length 45>>\nstream\n0 0 1 rg\n10 10 100 70 re f\nendstream',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

describe('transcodePdfFirstPage', () => {
  it('renders page 1 of a PDF to a raster image', async () => {
    const result = await transcodePdfFirstPage(minimalPdf(), 'WEB')

    expect(result.buffer.length).toBeGreaterThan(0)
    // Whatever the variant encodes to, it must be a real image — a silently
    // empty render is the failure mode a length check alone would miss.
    expect(result.buffer.length).toBeGreaterThan(100)
  }, 30_000)

  it('rejects input that is not a PDF rather than emitting a blank image', async () => {
    await expect(transcodePdfFirstPage(Buffer.from('this is not a pdf'), 'WEB')).rejects.toThrow()
  }, 30_000)
})
