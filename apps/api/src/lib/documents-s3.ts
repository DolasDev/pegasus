// ---------------------------------------------------------------------------
// S3 helpers for the document management system.
//
// Two pure functions that build presigned upload/download URLs for the
// documents bucket. The S3 client is a lazy singleton so Lambda cold-starts
// don't pay re-instantiation cost on every request.
//
// Callers MUST treat S3 keys as internal-only — they must not appear in any
// HTTP response body.
// ---------------------------------------------------------------------------

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/** Returns the configured documents bucket name, throwing if unset. */
export function documentsBucketName(): string {
  const name = process.env['DOCUMENTS_BUCKET_NAME']
  if (!name || name.length === 0) {
    throw new Error('DOCUMENTS_BUCKET_NAME environment variable is not set')
  }
  return name
}

let _client: S3Client | null = null
function client(): S3Client {
  return (_client ??= new S3Client({}))
}

/**
 * Builds the canonical S3 key for an uploaded document.
 *
 * The filename is sanitized to remove path-traversal characters and control
 * characters before it joins the key, so a malicious upload cannot escape its
 * tenant prefix.
 */
export function buildS3Key(opts: {
  tenantId: string
  entityType: string
  entityId: string
  documentId: string
  filename: string
}): string {
  const safe = opts.filename.replace(/[^\w.-]/g, '_')
  return `${opts.tenantId}/${opts.entityType}/${opts.entityId}/${opts.documentId}/${safe}`
}

/**
 * Issues a presigned PUT URL valid for 15 minutes.
 *
 * `ContentType` and `ContentLength` are baked into the signature so the
 * client cannot upload a different file type or a larger file than what
 * was authorised.
 */
export async function presignUpload(args: {
  key: string
  mimeType: string
  sizeBytes: number
}): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: documentsBucketName(),
      Key: args.key,
      ContentType: args.mimeType,
      ContentLength: args.sizeBytes,
    }),
    { expiresIn: 15 * 60 },
  )
}

/** Issues a presigned GET URL valid for 5 minutes. */
export async function presignDownload(key: string): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: documentsBucketName(), Key: key }), {
    expiresIn: 5 * 60,
  })
}
