// ---------------------------------------------------------------------------
// Document variant repository — persistence for the eager derived-asset cache.
//
// The converter Lambda is the primary writer: it upserts a PENDING row, then
// transitions it to READY or FAILED. The unique index on
// (document_id, variant) makes re-delivery of the S3 ObjectCreated event a
// no-op. The handler layer is a reader only and uses `findVariantsForDocument`
// to answer `?variant=` queries on the download-url endpoint.
//
// Like the Document repo, S3 keys leave this module only via the internal
// `*WithLocation` variant so the handler can sign a GET URL.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'
import type { DocumentVariant, DocumentVariantKind, DocumentVariantStatus } from '@pegasus/domain'
import { toDocumentId } from '@pegasus/domain'

type RawVariant = Prisma.DocumentVariantGetPayload<Record<string, never>>

function mapVariant(row: RawVariant): DocumentVariant {
  return {
    id: row.id,
    documentId: toDocumentId(row.documentId),
    variant: row.variant,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.sizeBytes != null ? { sizeBytes: row.sizeBytes } : {}),
    ...(row.width != null ? { width: row.width } : {}),
    ...(row.height != null ? { height: row.height } : {}),
    ...(row.failureReason != null ? { failureReason: row.failureReason } : {}),
    ...(row.generatedAt != null ? { generatedAt: row.generatedAt } : {}),
  }
}

/** Internal — bundles a variant with its S3 key for the download-url path. */
export type VariantWithLocation = {
  variant: DocumentVariant
  s3Key: string | null
}

function mapVariantWithLocation(row: RawVariant): VariantWithLocation {
  return { variant: mapVariant(row), s3Key: row.s3Key }
}

/**
 * Idempotently creates (or resets) a variant row in PENDING state. The
 * converter Lambda calls this at the start of a transcode attempt. If the
 * row already exists — e.g. a retried S3 event after a prior READY write —
 * we deliberately do NOT clobber `s3Key`/`sizeBytes` because those still
 * point at a valid object. Only stage back to PENDING when there was no
 * prior READY result to preserve; otherwise we leave the row alone by
 * making this a no-op via upsert update={}.
 */
export async function upsertPendingVariant(
  db: PrismaClient,
  documentId: string,
  variant: DocumentVariantKind,
): Promise<DocumentVariant> {
  const row = await db.documentVariant.upsert({
    where: { documentId_variant: { documentId, variant } },
    create: { documentId, variant, status: 'PENDING' },
    update: {},
  })
  return mapVariant(row)
}

export type MarkVariantReadyInput = {
  s3Key: string
  sizeBytes: number
  width: number
  height: number
}

/** Transitions a variant to READY, recording the S3 key and image metadata. */
export async function markVariantReady(
  db: PrismaClient,
  documentId: string,
  variant: DocumentVariantKind,
  input: MarkVariantReadyInput,
): Promise<DocumentVariant> {
  const row = await db.documentVariant.update({
    where: { documentId_variant: { documentId, variant } },
    data: {
      status: 'READY',
      s3Key: input.s3Key,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      generatedAt: new Date(),
      failureReason: null,
    },
  })
  return mapVariant(row)
}

/** Transitions a variant to FAILED with a short human-readable reason. */
export async function markVariantFailed(
  db: PrismaClient,
  documentId: string,
  variant: DocumentVariantKind,
  reason: string,
): Promise<DocumentVariant> {
  const row = await db.documentVariant.update({
    where: { documentId_variant: { documentId, variant } },
    data: {
      status: 'FAILED',
      failureReason: reason.slice(0, 500),
      generatedAt: new Date(),
    },
  })
  return mapVariant(row)
}

/** Lists every known variant for a document (both THUMB and WEB if present). */
export async function findVariantsForDocument(
  db: PrismaClient,
  documentId: string,
): Promise<DocumentVariant[]> {
  const rows = await db.documentVariant.findMany({
    where: { documentId },
    orderBy: { variant: 'asc' },
  })
  return rows.map(mapVariant)
}

/**
 * Looks up a single variant row with its S3 key. Used by the download-url
 * handler to decide whether to serve the variant or fall back to the
 * original. Returns null when no row exists (never been attempted) which the
 * handler interprets as "skipped type — fall back to original".
 */
export async function findVariantWithLocation(
  db: PrismaClient,
  documentId: string,
  variant: DocumentVariantKind,
): Promise<VariantWithLocation | null> {
  const row = await db.documentVariant.findUnique({
    where: { documentId_variant: { documentId, variant } },
  })
  return row ? mapVariantWithLocation(row) : null
}

/**
 * Convenience: returns the per-document variant status map for list responses,
 * shaped as `{ thumb: status, web: status }` where `status` is lower-case
 * for the HTTP surface. Missing rows report 'none'.
 */
export type VariantStatusMap = {
  thumb: 'ready' | 'pending' | 'failed' | 'none'
  web: 'ready' | 'pending' | 'failed' | 'none'
}

export async function variantStatusMapsForDocuments(
  db: PrismaClient,
  documentIds: readonly string[],
): Promise<Map<string, VariantStatusMap>> {
  if (documentIds.length === 0) return new Map()
  const rows = await db.documentVariant.findMany({
    where: { documentId: { in: [...documentIds] } },
    select: { documentId: true, variant: true, status: true },
  })
  const result = new Map<string, VariantStatusMap>()
  for (const id of documentIds) result.set(id, { thumb: 'none', web: 'none' })
  for (const row of rows) {
    const map = result.get(row.documentId)
    if (!map) continue
    const key = row.variant === 'THUMB' ? 'thumb' : 'web'
    map[key] = statusToWire(row.status)
  }
  return result
}

function statusToWire(s: DocumentVariantStatus): 'ready' | 'pending' | 'failed' {
  if (s === 'READY') return 'ready'
  if (s === 'FAILED') return 'failed'
  return 'pending'
}
