// ---------------------------------------------------------------------------
// Document bounded context
//
// Polymorphic file attachments belonging to any tenant entity (customer,
// quote, move, invoice, …). The domain type intentionally omits S3 storage
// coordinates — those are infrastructure concerns owned by the API layer
// and must never leak past the repository boundary.
// ---------------------------------------------------------------------------

import type { Brand } from '../shared/types'

/** Uniquely identifies a Document aggregate. */
export type DocumentId = Brand<string, 'DocumentId'>

export const toDocumentId = (raw: string): DocumentId => raw as DocumentId

/**
 * Lifecycle status of a Document. The upload state machine is:
 *   PENDING_UPLOAD → ACTIVE        (via finalize after S3 PUT succeeds)
 *                  → ARCHIVED       (hidden from default lists)
 *                  → PENDING_DELETION (soft delete; purged by worker)
 */
export type DocumentStatus = 'PENDING_UPLOAD' | 'ACTIVE' | 'ARCHIVED' | 'PENDING_DELETION'

/**
 * A file attached to any tenant entity.
 *
 * Note: there is intentionally no `s3Bucket` / `s3Key` here. Those are
 * infrastructure values held only by the repository layer; surfacing them
 * in API responses would leak the storage scheme.
 */
export interface Document {
  readonly id: DocumentId
  readonly entityType: string
  readonly entityId: string
  readonly documentType: string
  readonly filename: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly status: DocumentStatus
  readonly uploadedBy: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly category?: string
  readonly expiresAt?: Date
}
