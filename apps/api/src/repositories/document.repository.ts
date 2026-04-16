// ---------------------------------------------------------------------------
// Document repository — persistence for polymorphic file attachments.
//
// All functions take a tenant-scoped `db` (from `c.get('db')`); tenant_id is
// applied automatically by the Prisma extension. Mappers strip S3 coordinates
// before returning a domain `Document`. The two `*WithLocation` variants are
// the only escape hatch and are used solely by the upload/download handlers.
// ---------------------------------------------------------------------------

import type { PrismaClient, Prisma } from '@prisma/client'
import type { Document } from '@pegasus/domain'
import { toDocumentId } from '@pegasus/domain'

type RawDocument = Prisma.DocumentGetPayload<Record<string, never>>

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/** Maps a Prisma row to the domain type, intentionally dropping S3 fields. */
function mapDocument(row: RawDocument): Document {
  return {
    id: toDocumentId(row.id),
    entityType: row.entityType,
    entityId: row.entityId,
    documentType: row.documentType,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.category != null ? { category: row.category } : {}),
    ...(row.expiresAt != null ? { expiresAt: row.expiresAt } : {}),
  }
}

/** Internal-only — bundles the domain type with raw S3 coordinates. */
export type DocumentWithLocation = {
  document: Document
  s3Bucket: string
  s3Key: string
}

function mapDocumentWithLocation(row: RawDocument): DocumentWithLocation {
  return {
    document: mapDocument(row),
    s3Bucket: row.s3Bucket,
    s3Key: row.s3Key,
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type CreatePendingDocumentInput = {
  /** Optional pre-generated id; lets the caller embed it in the S3 key before insert. */
  id?: string
  entityType: string
  entityId: string
  documentType: string
  filename: string
  mimeType: string
  sizeBytes: number
  s3Bucket: string
  s3Key: string
  uploadedBy: string
  tenantId: string
  category?: string
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

/**
 * Inserts a row in `PENDING_UPLOAD` state. The caller is responsible for
 * issuing the presigned PUT URL after this returns.
 *
 * `tenantId` is required here because the row needs an FK target — the
 * tenant-scoped Prisma extension cannot synthesise it for INSERTs on this
 * model. The extension still enforces tenant scoping on every read.
 */
export async function createPendingDocument(
  db: PrismaClient,
  input: CreatePendingDocumentInput,
): Promise<DocumentWithLocation> {
  const row = await db.document.create({
    data: {
      ...(input.id != null ? { id: input.id } : {}),
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      documentType: input.documentType,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      s3Bucket: input.s3Bucket,
      s3Key: input.s3Key,
      uploadedBy: input.uploadedBy,
      status: 'PENDING_UPLOAD',
      ...(input.category != null ? { category: input.category } : {}),
    },
  })
  return mapDocumentWithLocation(row)
}

/** Promotes `PENDING_UPLOAD → ACTIVE`. Returns null if the row is missing. */
export async function finalizeDocument(db: PrismaClient, id: string): Promise<Document | null> {
  const exists = await db.document.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null
  const row = await db.document.update({
    where: { id },
    data: { status: 'ACTIVE' },
  })
  return mapDocument(row)
}

/**
 * Internal lookup that returns S3 coordinates alongside the domain type.
 * Callers must NEVER serialize the `s3Bucket` / `s3Key` fields into a
 * response body — they are intended only for the download URL signer.
 */
export async function findDocumentByIdWithLocation(
  db: PrismaClient,
  id: string,
): Promise<DocumentWithLocation | null> {
  const row = await db.document.findUnique({ where: { id } })
  return row ? mapDocumentWithLocation(row) : null
}

/** Safe lookup for list/get response paths. Returns the domain type only. */
export async function findDocumentById(db: PrismaClient, id: string): Promise<Document | null> {
  const row = await db.document.findUnique({ where: { id } })
  return row ? mapDocument(row) : null
}

/** Looks up a document by its S3 key. Used by the converter Lambda. */
export async function findDocumentByS3Key(
  db: PrismaClient,
  s3Key: string,
): Promise<DocumentWithLocation | null> {
  const row = await db.document.findFirst({ where: { s3Key } })
  return row ? mapDocumentWithLocation(row) : null
}

/** Lists ACTIVE documents for a given entity, newest first. */
export async function listDocumentsForEntity(
  db: PrismaClient,
  entityType: string,
  entityId: string,
): Promise<Document[]> {
  const rows = await db.document.findMany({
    where: { entityType, entityId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(mapDocument)
}

/** Soft-deletes a document. Returns null if missing. */
export async function softDeleteDocument(db: PrismaClient, id: string): Promise<Document | null> {
  const exists = await db.document.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null
  const row = await db.document.update({
    where: { id },
    data: { status: 'PENDING_DELETION', deletedAt: new Date() },
  })
  return mapDocument(row)
}

/** Marks a document as ARCHIVED. Returns null if missing. */
export async function archiveDocument(db: PrismaClient, id: string): Promise<Document | null> {
  const exists = await db.document.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return null
  const row = await db.document.update({
    where: { id },
    data: { status: 'ARCHIVED' },
  })
  return mapDocument(row)
}
