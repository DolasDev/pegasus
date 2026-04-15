/**
 * Integration tests for the document repository.
 *
 * Requires a live PostgreSQL database. Skipped automatically when
 * DATABASE_URL is not set.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import type { PrismaClient } from '@prisma/client'
import {
  archiveDocument,
  createPendingDocument,
  finalizeDocument,
  findDocumentById,
  findDocumentByIdWithLocation,
  listDocumentsForEntity,
  softDeleteDocument,
} from '../document.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const TEST_TENANT_SLUG = 'test-document-repo'
const createdIds: string[] = []
let testDb: PrismaClient
let testTenantId: string

afterAll(async () => {
  if (hasDb) {
    for (const id of createdIds) {
      await db.document.delete({ where: { id } }).catch(() => undefined)
    }
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('DocumentRepository (integration)', () => {
  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Document Repo)', slug: TEST_TENANT_SLUG },
      update: {},
    })
    testTenantId = tenant.id
    testDb = createTenantDb(db, testTenantId) as unknown as PrismaClient
  })

  it('walks PENDING_UPLOAD → ACTIVE → list → archive → soft delete', async () => {
    const created = await createPendingDocument(testDb, {
      tenantId: testTenantId,
      entityType: 'customer',
      entityId: 'cust-xyz',
      documentType: 'contract',
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      s3Bucket: 'test-bucket',
      s3Key: 'test-bucket/test-key',
      uploadedBy: 'user-1',
    })
    createdIds.push(created.document.id)

    expect(created.document.status).toBe('PENDING_UPLOAD')
    expect(created.s3Key).toBe('test-bucket/test-key')

    const finalized = await finalizeDocument(testDb, created.document.id)
    expect(finalized?.status).toBe('ACTIVE')

    const fetched = await findDocumentById(testDb, created.document.id)
    expect(fetched?.id).toBe(created.document.id)
    // Domain type must not carry s3 fields.
    expect(fetched as unknown as Record<string, unknown>).not.toHaveProperty('s3Key')

    const withLoc = await findDocumentByIdWithLocation(testDb, created.document.id)
    expect(withLoc?.s3Bucket).toBe('test-bucket')

    const list = await listDocumentsForEntity(testDb, 'customer', 'cust-xyz')
    expect(list.find((d) => d.id === created.document.id)).toBeTruthy()

    const archived = await archiveDocument(testDb, created.document.id)
    expect(archived?.status).toBe('ARCHIVED')

    const deleted = await softDeleteDocument(testDb, created.document.id)
    expect(deleted?.status).toBe('PENDING_DELETION')
  })

  it('returns null on missing finalize/archive/delete', async () => {
    expect(await finalizeDocument(testDb, 'nonexistent-id')).toBeNull()
    expect(await archiveDocument(testDb, 'nonexistent-id')).toBeNull()
    expect(await softDeleteDocument(testDb, 'nonexistent-id')).toBeNull()
  })
})
