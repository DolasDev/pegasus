import type { S3Event } from 'aws-lambda'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { DocumentVariantKind } from '@pegasus/domain'
import { createLogger } from './lib/logger'
import { buildVariantS3Key } from './lib/documents-s3'
import { isTranscodable, transcodeImage, transcodePdfFirstPage } from './lib/document-transcode'
import { findDocumentByS3Key } from './repositories/document.repository'
import {
  upsertPendingVariant,
  markVariantReady,
  markVariantFailed,
} from './repositories/document-variant.repository'
import { db } from './db'

const logger = createLogger('pegasus-document-converter')
const s3 = new S3Client({})

const VARIANTS: DocumentVariantKind[] = ['THUMB', 'WEB']

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))

    if (!key.includes('/original/')) {
      logger.warn('Skipping non-original key', { key })
      continue
    }

    logger.info('Processing document', { bucket, key })

    const doc = await findDocumentByS3Key(db, key)
    if (!doc) {
      logger.warn('No Document row for S3 key — may have been deleted', { key })
      continue
    }

    if (!isTranscodable(doc.document.mimeType)) {
      logger.info('Skipping non-transcodable mime type', {
        documentId: doc.document.id,
        mimeType: doc.document.mimeType,
      })
      continue
    }

    const original = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const body = await original.Body?.transformToByteArray()
    if (!body) {
      throw new Error(`Empty body from S3 for key ${key}`)
    }
    const inputBuffer = Buffer.from(body)

    const segments = key.split('/')
    const tenantId = segments[0]!
    const entityType = segments[1]!
    const entityId = segments[2]!
    const documentId = segments[3]!

    for (const variant of VARIANTS) {
      await upsertPendingVariant(db, doc.document.id as string, variant)

      try {
        const isPdf = doc.document.mimeType === 'application/pdf'
        const result = isPdf
          ? await transcodePdfFirstPage(inputBuffer, variant)
          : await transcodeImage(inputBuffer, variant)

        const variantKey = buildVariantS3Key({
          tenantId,
          entityType,
          entityId,
          documentId,
          variant: variant === 'THUMB' ? 'thumb' : 'web',
        })

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: variantKey,
            Body: result.buffer,
            ContentType: 'image/jpeg',
          }),
        )

        await markVariantReady(db, doc.document.id as string, variant, {
          s3Key: variantKey,
          sizeBytes: result.buffer.length,
          width: result.width,
          height: result.height,
        })

        logger.info('Variant ready', {
          documentId: doc.document.id,
          variant,
          sizeBytes: result.buffer.length,
          width: result.width,
          height: result.height,
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logger.warn('Transcode failed', {
          documentId: doc.document.id,
          variant,
          reason,
        })
        await markVariantFailed(db, doc.document.id as string, variant, reason)
      }
    }
  }
}
