import * as FileSystem from 'expo-file-system/legacy'
import { getApiClient } from '../api/client'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// Document service — lists and uploads documents attached to a longhaul
// shipment/order via the cloud documents API (apps/api documents handler).
//
// Documents are linked polymorphically by (entityType, entityId); for a
// shipment that is ('shipment', order_num). Upload is a three-step presigned
// flow so large files stream straight to S3, never through the API Lambda:
//   1. POST /documents/upload-url  → reserve a row + get a presigned PUT URL
//   2. PUT the bytes directly to S3 (Content-Type must match the presign)
//   3. POST /documents/:id/finalize → promote the row to ACTIVE
// ---------------------------------------------------------------------------

const ENTITY_TYPE = 'shipment'

export type DocumentVariantState = 'ready' | 'pending' | 'unavailable' | 'none'

/** A document row as returned by GET /documents/entity/shipment/:orderNum. */
export interface DocumentSummary {
  id: string
  entityType: string
  entityId: string
  documentType: string
  category?: string | null
  filename: string
  mimeType: string
  sizeBytes: number
  status: string
  createdAt: string
  variants?: { thumb: DocumentVariantState; web: DocumentVariantState }
}

export interface UploadDocumentParams {
  orderNum: string | number
  documentType: string
  fileUri: string
  filename: string
  mimeType: string
  sizeBytes: number
}

interface UploadUrlResponse {
  documentId: string
  uploadUrl: string
  expiresInSeconds: number
}

export class DocumentService {
  /** List the ACTIVE documents attached to a shipment, newest first. */
  static async listForShipment(orderNum: string | number): Promise<DocumentSummary[]> {
    const client = getApiClient()
    const res = await client.fetchPaginated<DocumentSummary>(
      `/api/v1/documents/entity/${ENTITY_TYPE}/${encodeURIComponent(String(orderNum))}`,
    )
    return res.data
  }

  /** Resolve a short-lived presigned download URL for a document. */
  static async getDownloadUrl(
    documentId: string,
    variant?: 'thumb' | 'web' | 'original',
  ): Promise<string> {
    const client = getApiClient()
    const q = variant ? `?variant=${variant}` : ''
    const res = await client.fetch<{ downloadUrl: string; variantStatus?: string }>(
      `/api/v1/documents/${documentId}/download-url${q}`,
    )
    return res.downloadUrl
  }

  /**
   * Upload one prepared file (a PDF or image) and attach it to the shipment.
   * `sizeBytes` MUST equal the actual byte length of `fileUri` — the presign
   * signs Content-Length, so S3 rejects a mismatch.
   */
  static async uploadDocument(params: UploadDocumentParams): Promise<DocumentSummary> {
    const client = getApiClient()

    // 1. Reserve the row + get the presigned PUT URL.
    const reserved = await client.fetch<UploadUrlResponse>('/api/v1/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        entityType: ENTITY_TYPE,
        entityId: String(params.orderNum),
        documentType: params.documentType,
        filename: params.filename,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
      }),
    })

    // 2. PUT the bytes straight to S3. Presigned URLs are self-authenticating,
    //    so no bearer token here; Content-Type must match what was signed.
    const put = await FileSystem.uploadAsync(reserved.uploadUrl, params.fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': params.mimeType },
    })
    if (put.status < 200 || put.status >= 300) {
      logger.error('Document S3 upload failed', { status: put.status, body: put.body })
      throw new Error(`Upload failed (storage returned ${put.status})`)
    }

    // 3. Promote the row to ACTIVE.
    return client.fetch<DocumentSummary>(`/api/v1/documents/${reserved.documentId}/finalize`, {
      method: 'POST',
    })
  }
}
