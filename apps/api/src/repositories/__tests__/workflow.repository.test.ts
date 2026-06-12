// ---------------------------------------------------------------------------
// Unit tests for the workflow repository fork path (Phase 3 Unit 6)
//
// Unlike the sibling integration suites this is a pure unit test: the S3 copy
// is mocked and the Prisma client is a capturing stub, so it always runs (no
// DATABASE_URL needed). It pins the Unit 6 contract that forking PROPAGATES
// the artifact-integrity fields from the source row instead of re-downloading
// and re-validating — the S3 server-side copy is byte-identical by contract.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const { mockCopyObject } = vi.hoisted(() => ({ mockCopyObject: vi.fn() }))

vi.mock('../../lib/documents-s3', () => ({
  copyObject: mockCopyObject,
}))

import { createWorkflowRepository } from '../workflow.repository'
import type { WorkflowRow } from '../workflow.repository'

const sourceRow: WorkflowRow = {
  id: 'global-wf-1',
  tenantId: 'platform-tenant-id',
  name: 'send_quote_followup',
  version: '1.0.0',
  visibility: 'GLOBAL',
  artifactKey: 'workflows/platform-tenant-id/global-wf-1/1.0.0.zip',
  manifest: { name: 'send_quote_followup', version: '1.0.0' },
  createdByUserId: 'platform-user',
  forkedFromWorkflowId: null,
  forkedFromVersion: null,
  runtimeTokenCiphertext: 'SOURCE-CIPHERTEXT',
  runtimeApiClientId: 'source-api-client',
  artifactSha256: 'a'.repeat(64),
  artifactSizeBytes: 2116,
  executable: true,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
}

describe('workflow.repository forkGlobalToTenant', () => {
  const create = vi.fn()
  const db = { workflow: { create } } as unknown as PrismaClient

  beforeEach(() => {
    vi.clearAllMocks()
    create.mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve(args.data),
    )
  })

  it('propagates artifact-integrity fields from the source row without re-validating', async () => {
    const repo = createWorkflowRepository(db)
    await repo.forkGlobalToTenant(sourceRow, 'tenant-b', 'user-b')

    expect(create).toHaveBeenCalledTimes(1)
    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>
    expect(data['artifactSha256']).toBe(sourceRow.artifactSha256)
    expect(data['artifactSizeBytes']).toBe(sourceRow.artifactSizeBytes)
    expect(data['executable']).toBe(true)
    // Provenance + ownership
    expect(data['tenantId']).toBe('tenant-b')
    expect(data['visibility']).toBe('TENANT')
    expect(data['forkedFromWorkflowId']).toBe('global-wf-1')
    expect(data['forkedFromVersion']).toBe('1.0.0')
    // Runtime credentials never carry over — each fork mints its own.
    expect(data['runtimeTokenCiphertext']).toBeUndefined()
    expect(data['runtimeApiClientId']).toBeUndefined()
    // The byte-identical S3 copy ran against the source key.
    expect(mockCopyObject).toHaveBeenCalledWith(
      sourceRow.artifactKey,
      expect.stringMatching(/^workflows\/tenant-b\/[0-9a-f-]+\/1\.0\.0\.zip$/),
    )
  })

  it('propagates a non-executable legacy source as non-executable (no laundering)', async () => {
    const repo = createWorkflowRepository(db)
    const legacySource: WorkflowRow = {
      ...sourceRow,
      artifactSha256: null,
      artifactSizeBytes: null,
      executable: false,
    }
    await repo.forkGlobalToTenant(legacySource, 'tenant-b', 'user-b')

    const data = create.mock.calls[0]?.[0]?.data as Record<string, unknown>
    expect(data['artifactSha256']).toBeNull()
    expect(data['artifactSizeBytes']).toBeNull()
    expect(data['executable']).toBe(false)
  })
})
