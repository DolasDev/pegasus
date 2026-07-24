// ---------------------------------------------------------------------------
// Unit tests for the api-client repository — no database.
//
// The sibling api-client.repository.test.ts is DB-integration (skips without
// DATABASE_URL). These tests mock Prisma so the branch logic added for
// service-account deletion and workflow-runtime hiding is always exercised,
// including in the no-DB pre-push/CI coverage run.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createApiClientRepository } from '../api-client.repository'

// ---------------------------------------------------------------------------
// deleteWithServiceAccount
// ---------------------------------------------------------------------------

describe('deleteWithServiceAccount (mocked)', () => {
  function makeTx(client: { id: string; actsAsUserId: string | null } | null, refCount = 0) {
    return {
      apiClient: {
        findFirst: vi.fn().mockResolvedValue(client),
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(refCount),
      },
      tenantUser: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }
  }

  function makeDb(tx: ReturnType<typeof makeTx>) {
    return {
      $transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    } as unknown as PrismaClient
  }

  it('deletes the client then its bound service account (client first, then user)', async () => {
    const tx = makeTx({ id: 'c1', actsAsUserId: 'svc1' }, 0)
    const repo = createApiClientRepository(makeDb(tx))

    await repo.deleteWithServiceAccount('c1', 't1')

    expect(tx.apiClient.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    expect(tx.tenantUser.deleteMany).toHaveBeenCalledWith({
      where: { id: 'svc1', isServiceAccount: true },
    })
    // Ordering: the ApiClient must be gone before we remove the principal so
    // the onDelete: Restrict FK is released.
    const clientDeleteOrder = tx.apiClient.delete.mock.invocationCallOrder[0]!
    const userDeleteOrder = tx.tenantUser.deleteMany.mock.invocationCallOrder[0]!
    expect(clientDeleteOrder).toBeLessThan(userDeleteOrder)
  })

  it('does nothing when the client is not found in the tenant', async () => {
    const tx = makeTx(null)
    const repo = createApiClientRepository(makeDb(tx))

    await repo.deleteWithServiceAccount('missing', 't1')

    expect(tx.apiClient.delete).not.toHaveBeenCalled()
    expect(tx.tenantUser.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes only the client when it has no bound principal', async () => {
    const tx = makeTx({ id: 'c2', actsAsUserId: null })
    const repo = createApiClientRepository(makeDb(tx))

    await repo.deleteWithServiceAccount('c2', 't1')

    expect(tx.apiClient.delete).toHaveBeenCalledWith({ where: { id: 'c2' } })
    expect(tx.tenantUser.deleteMany).not.toHaveBeenCalled()
  })

  it('keeps the principal when another api client still references it', async () => {
    const tx = makeTx({ id: 'c3', actsAsUserId: 'svc-shared' }, 1)
    const repo = createApiClientRepository(makeDb(tx))

    await repo.deleteWithServiceAccount('c3', 't1')

    expect(tx.apiClient.delete).toHaveBeenCalledWith({ where: { id: 'c3' } })
    expect(tx.tenantUser.deleteMany).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listByTenant — workflow-runtime hiding
// ---------------------------------------------------------------------------

describe('listByTenant runtime-client exclusion (mocked)', () => {
  function makeDb(runtimeOwners: Array<{ runtimeApiClientId: string | null }>) {
    const apiClientFindMany = vi.fn().mockResolvedValue([])
    const db = {
      workflow: { findMany: vi.fn().mockResolvedValue(runtimeOwners) },
      apiClient: { findMany: apiClientFindMany },
    } as unknown as PrismaClient
    return { db, apiClientFindMany }
  }

  it('excludes ids referenced by a workflow runtimeApiClientId (nulls dropped)', async () => {
    const { db, apiClientFindMany } = makeDb([
      { runtimeApiClientId: 'r1' },
      { runtimeApiClientId: null },
      { runtimeApiClientId: 'r2' },
    ])
    const repo = createApiClientRepository(db)

    await repo.listByTenant('t1')

    const where = apiClientFindMany.mock.calls[0]![0].where as Record<string, unknown>
    expect(where['tenantId']).toBe('t1')
    expect(where['id']).toEqual({ notIn: ['r1', 'r2'] })
  })

  it('omits the id filter entirely when the tenant has no runtime clients', async () => {
    const { db, apiClientFindMany } = makeDb([])
    const repo = createApiClientRepository(db)

    await repo.listByTenant('t1')

    const where = apiClientFindMany.mock.calls[0]![0].where as Record<string, unknown>
    expect(where['tenantId']).toBe('t1')
    expect('id' in where).toBe(false)
  })
})
