import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { S3Event } from 'aws-lambda'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('../db', () => ({ db: {} }))

vi.mock('../repositories/document.repository', () => ({
  findDocumentByS3Key: vi.fn(),
}))

vi.mock('../repositories/document-variant.repository', () => ({
  upsertPendingVariant: vi.fn().mockResolvedValue({}),
  markVariantReady: vi.fn().mockResolvedValue({}),
  markVariantFailed: vi.fn().mockResolvedValue({}),
}))

vi.mock('../lib/document-transcode', () => ({
  isTranscodable: vi.fn(),
  transcodeImage: vi.fn(),
  transcodePdfFirstPage: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class {
      send = mockSend
    },
    GetObjectCommand: vi.fn(),
    PutObjectCommand: vi.fn(),
  }
})

import { handler } from '../lambda-document-converter'
import { findDocumentByS3Key } from '../repositories/document.repository'
import {
  upsertPendingVariant,
  markVariantReady,
  markVariantFailed,
} from '../repositories/document-variant.repository'
import { isTranscodable, transcodeImage } from '../lib/document-transcode'

function makeS3Event(key: string, bucket = 'test-bucket'): S3Event {
  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-east-1',
        eventTime: '2026-01-01T00:00:00.000Z',
        eventName: 'ObjectCreated:Put',
        userIdentity: { principalId: 'test' },
        requestParameters: { sourceIPAddress: '127.0.0.1' },
        responseElements: {
          'x-amz-request-id': 'test',
          'x-amz-id-2': 'test',
        },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test',
          bucket: {
            name: bucket,
            ownerIdentity: { principalId: 'test' },
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key: encodeURIComponent(key),
            size: 1000,
            eTag: 'test',
            sequencer: 'test',
          },
        },
      },
    ],
  }
}

describe('document converter Lambda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips keys without /original/ segment', async () => {
    const event = makeS3Event('tenant/customer/ent1/doc1/photo.jpg')
    await handler(event)
    expect(findDocumentByS3Key).not.toHaveBeenCalled()
  })

  it('skips when no Document row exists for the key', async () => {
    ;(findDocumentByS3Key as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const event = makeS3Event('tenant/customer/ent1/doc1/original/photo.jpg')
    await handler(event)
    expect(upsertPendingVariant).not.toHaveBeenCalled()
  })

  it('skips non-transcodable mime types', async () => {
    ;(findDocumentByS3Key as ReturnType<typeof vi.fn>).mockResolvedValue({
      document: { id: 'doc1', mimeType: 'application/msword', status: 'ACTIVE' },
      s3Key: 'tenant/customer/ent1/doc1/original/file.doc',
      s3Bucket: 'test-bucket',
    })
    ;(isTranscodable as ReturnType<typeof vi.fn>).mockReturnValue(false)

    const event = makeS3Event('tenant/customer/ent1/doc1/original/file.doc')
    await handler(event)
    expect(upsertPendingVariant).not.toHaveBeenCalled()
  })

  it('creates THUMB and WEB variants for transcodable images', async () => {
    const mockDoc = {
      document: { id: 'doc1', mimeType: 'image/jpeg', status: 'ACTIVE' },
      s3Key: 'tenant/customer/ent1/doc1/original/photo.jpg',
      s3Bucket: 'test-bucket',
    }
    ;(findDocumentByS3Key as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc)
    ;(isTranscodable as ReturnType<typeof vi.fn>).mockReturnValue(true)

    const resultBuffer = Buffer.from('fake-jpeg')
    ;(transcodeImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      buffer: resultBuffer,
      width: 400,
      height: 300,
    })

    const mockBody = { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) }
    mockSend.mockResolvedValue({ Body: mockBody })

    const event = makeS3Event('tenant/customer/ent1/doc1/original/photo.jpg')
    await handler(event)

    expect(upsertPendingVariant).toHaveBeenCalledTimes(2)
    expect(upsertPendingVariant).toHaveBeenCalledWith(expect.anything(), 'doc1', 'THUMB')
    expect(upsertPendingVariant).toHaveBeenCalledWith(expect.anything(), 'doc1', 'WEB')
    expect(markVariantReady).toHaveBeenCalledTimes(2)
  })

  it('marks variant FAILED on transcode error without throwing', async () => {
    const mockDoc = {
      document: { id: 'doc1', mimeType: 'image/heic', status: 'ACTIVE' },
      s3Key: 'tenant/customer/ent1/doc1/original/photo.heic',
      s3Bucket: 'test-bucket',
    }
    ;(findDocumentByS3Key as ReturnType<typeof vi.fn>).mockResolvedValue(mockDoc)
    ;(isTranscodable as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(transcodeImage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Corrupt HEIC'))

    const mockBody = { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) }
    mockSend.mockResolvedValue({ Body: mockBody })

    const event = makeS3Event('tenant/customer/ent1/doc1/original/photo.heic')

    await expect(handler(event)).resolves.toBeUndefined()

    expect(markVariantFailed).toHaveBeenCalledTimes(2)
    expect(markVariantFailed).toHaveBeenCalledWith(
      expect.anything(),
      'doc1',
      'THUMB',
      'Corrupt HEIC',
    )
  })
})
