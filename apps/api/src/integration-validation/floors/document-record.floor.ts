// ---------------------------------------------------------------------------
// document_record — a per-TYPE integration floor (sdk-feedback 0024) for a
// DOCUMENT metadata record: an identified document with a kind, a file format,
// references, and metadata. PARTNER-NEUTRAL — any document-metadata feed (Sirva
// ADE document / GetImageList is the first) builds on this floor. Exposes only
// GENERIC facts; partner value sets (allowed file formats, brand codes) live in
// the overlay rules via `nin`.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { CanonicalContext, TypeFloor } from '../types'
import type { Facts, FactCatalog } from '../rules/types'

export const DOCUMENT_RECORD_FLOOR = 'document_record'

const optStr = z.string().nullish()
const optNum = z.number().nullish()

// Sections are optional: a partner-neutral floor accepts a config that maps only
// the fields it cares about.
export const DocumentRecordSchema = z.object({
  Id: optStr,
  Reference: z
    .object({ Brand: optStr, ReferenceNumber: optStr, BatchNumber: optStr, ScanLocation: optStr })
    .nullish(),
  Kind: optStr,
  Category: optStr,
  Title: optStr,
  Description: optStr,
  Format: optStr,
  PageCount: optNum,
  FileSize: optNum,
  Date: optStr,
  DateIn: optStr,
})

export type DocumentRecord = z.infer<typeof DocumentRecordSchema>

const has = (v: string | null | undefined): boolean => v != null && v !== ''

export const documentRecordFactCatalog: FactCatalog = {
  idPresent: 'boolean',
  format: 'string',
  formatPresent: 'boolean',
  brand: 'string',
  brandPresent: 'boolean',
}

export function deriveDocumentRecordFacts(ctx: CanonicalContext<DocumentRecord>): Facts {
  const { order } = ctx
  const format = order.Format
  const brand = order.Reference?.Brand
  return {
    idPresent: has(order.Id),
    format: has(format) ? String(format).toUpperCase() : '',
    formatPresent: has(format),
    brand: has(brand) ? String(brand).toUpperCase() : '',
    brandPresent: has(brand),
  }
}

export const documentRecordFloor: TypeFloor = {
  floor: DOCUMENT_RECORD_FLOOR,
  structuralContract: DocumentRecordSchema,
  deriveFacts: deriveDocumentRecordFacts,
  factCatalog: documentRecordFactCatalog,
  defaultAction: 'save',
  // Natural key {Id} (0026).
  projection: {
    entityType: 'document',
    key: (o) => (typeof o?.Id === 'string' && o.Id !== '' ? o.Id : null),
  },
}
