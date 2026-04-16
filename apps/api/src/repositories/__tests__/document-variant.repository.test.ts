/**
 * Integration tests for the document variant repository.
 *
 * Requires a live PostgreSQL database. Skipped automatically when
 * DATABASE_URL is not set.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import type { PrismaClient } from '@prisma/client'
import { createPendingDocument } from '../document.repository'
import {
  findVariantWithLocation,
  findVariantsForDocument,
  markVariantFailed,
  markVariantReady,
  upsertPendingVariant,
  variantStatusMapsForDocuments,
} from '../document-variant.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TEST_TENANT_SLUG = 'test-doc-variant-repo'
const createdDocumentIds: string[] = []
let testDb: PrismaClient
let testTenantId: string

afterAll(async () => {
  if (hasDb) {
    for (const id of createdDocumentIds) {
      // Variants cascade-delete with their parent document.
      await db.document.delete({ where: { id } }).catch(() => undefined)
    }
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('DocumentVariantRepository (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Doc Variants)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    testTenantId = tenant.id
    testDb = createTenantDb(db, testTenantId) as unknown as PrismaClient
  })

  async function newDocument(): Promise<string> {
    const created = await createPendingDocument(testDb, {
      tenantId: testTenantId,
      entityType: 'customer',
      entityId: 'cust-variant-test',
      documentType: 'photo',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      s3Bucket: 'test-bucket',
      s3Key: `test-bucket/${Math.random().toString(36).slice(2)}/original/photo.jpg`,
      uploadedBy: 'user-1',
    })
    createdDocumentIds.push(created.document.id)
    return created.document.id
  }

  it('upsert is idempotent and marks ready stores s3 metadata', async () => {
    const docId = await newDocument()

    const first = await upsertPendingVariant(testDb, docId, 'THUMB')
    expect(first.status).toBe('PENDING')
    const second = await upsertPendingVariant(testDb, docId, 'THUMB')
    expect(second.id).toBe(first.id) // upsert → same row

    const ready = await markVariantReady(testDb, docId, 'THUMB', {
      s3Key: 'variants/thumb.jpg',
      sizeBytes: 1234,
      width: 400,
      height: 300,
    })
    expect(ready.status).toBe('READY')
    expect(ready.width).toBe(400)

    const located = await findVariantWithLocation(testDb, docId, 'THUMB')
    expect(located?.s3Key).toBe('variants/thumb.jpg')
    expect(located?.variant.status).toBe('READY')
  })

  it('markVariantFailed records the reason and truncates long strings', async () => {
    const docId = await newDocument()
    await upsertPendingVariant(testDb, docId, 'WEB')

    const long = 'x'.repeat(1000)
    const failed = await markVariantFailed(testDb, docId, 'WEB', long)
    expect(failed.status).toBe('FAILED')
    expect(failed.failureReason?.length).toBe(500)
  })

  it('variantStatusMapsForDocuments reports none for missing rows', async () => {
    const docId = await newDocument()
    await upsertPendingVariant(testDb, docId, 'THUMB')
    await markVariantReady(testDb, docId, 'THUMB', {
      s3Key: 'variants/thumb.jpg',
      sizeBytes: 100,
      width: 10,
      height: 10,
    })

    const map = await variantStatusMapsForDocuments(testDb, [docId])
    expect(map.get(docId)).toEqual({ thumb: 'ready', web: 'none' })
  })

  it('findVariantsForDocument returns both when present', async () => {
    const docId = await newDocument()
    await upsertPendingVariant(testDb, docId, 'THUMB')
    await upsertPendingVariant(testDb, docId, 'WEB')
    const rows = await findVariantsForDocument(testDb, docId)
    expect(rows.map((r) => r.variant).sort()).toEqual(['THUMB', 'WEB'])
  })
})
