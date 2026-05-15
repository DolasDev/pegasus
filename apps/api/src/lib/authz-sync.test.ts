// ---------------------------------------------------------------------------
// Unit tests for the AVP policy reconciliation library.
//
// Validates the contract the deploy-time Trigger depends on:
//   - syncTenantPolicies deletes every existing STATIC policy in the store,
//     then re-creates one per `.cedar` file from loadPolicies().
//   - Paginated ListPolicies responses are followed to the end.
//   - syncAllTenantPolicies fans out across tenants and aggregates per-tenant
//     failures into the result rather than throwing mid-flight (so the Trigger
//     handler can decide whether to fail the deploy).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as VPModule from '@aws-sdk/client-verifiedpermissions'

const sendMock = vi.fn()

vi.mock('@aws-sdk/client-verifiedpermissions', async () => {
  const actual = await vi.importActual<typeof VPModule>('@aws-sdk/client-verifiedpermissions')
  return {
    ...actual,
    VerifiedPermissionsClient: class {
      send(cmd: unknown) {
        return sendMock(cmd)
      }
    },
  }
})

vi.mock('../db', () => ({
  db: {
    tenant: {
      findMany: vi.fn(),
    },
  },
}))

import {
  ListPoliciesCommand,
  CreatePolicyCommand,
  DeletePolicyCommand,
} from '@aws-sdk/client-verifiedpermissions'
import { syncTenantPolicies, syncAllTenantPolicies } from './authz-sync'
import { loadPolicies } from '../authz/load'
import { db } from '../db'

beforeEach(() => {
  sendMock.mockReset()
  vi.mocked(db.tenant.findMany).mockReset()
})

describe('syncTenantPolicies', () => {
  it('deletes every existing static policy and recreates one per .cedar file', async () => {
    const existingPolicyIds = ['pol-1', 'pol-2', 'pol-3']
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListPoliciesCommand) {
        return Promise.resolve({
          policies: existingPolicyIds.map((id) => ({
            policyId: id,
            policyStoreId: 'ps-A',
            policyType: 'STATIC',
          })),
        })
      }
      if (cmd instanceof DeletePolicyCommand) return Promise.resolve({})
      if (cmd instanceof CreatePolicyCommand) return Promise.resolve({ policyId: 'new-id' })
      throw new Error(`Unexpected command: ${cmd?.constructor.name}`)
    })

    const result = await syncTenantPolicies('ps-A')

    const fileCount = loadPolicies().length
    expect(result).toEqual({ policyStoreId: 'ps-A', deleted: 3, created: fileCount })

    const deletes = sendMock.mock.calls.filter((c) => c[0] instanceof DeletePolicyCommand)
    expect(deletes).toHaveLength(3)
    for (const [cmd] of deletes) {
      const input = (cmd as DeletePolicyCommand).input
      expect(input.policyStoreId).toBe('ps-A')
      expect(existingPolicyIds).toContain(input.policyId)
    }

    const creates = sendMock.mock.calls.filter((c) => c[0] instanceof CreatePolicyCommand)
    expect(creates).toHaveLength(fileCount)
    // Every create targets the same store and references a static definition
    // sourced from the in-memory loadPolicies() set.
    const fileNames = new Set(loadPolicies().map((p) => p.name))
    for (const [cmd] of creates) {
      const input = (cmd as CreatePolicyCommand).input
      expect(input.policyStoreId).toBe('ps-A')
      expect(input.definition?.static).toBeDefined()
      expect(fileNames.has(input.definition!.static!.description!)).toBe(true)
    }
  })

  it('follows ListPolicies pagination to the end', async () => {
    const pageOne = [{ policyId: 'a', policyStoreId: 'ps-B', policyType: 'STATIC' }]
    const pageTwo = [{ policyId: 'b', policyStoreId: 'ps-B', policyType: 'STATIC' }]
    let listCallCount = 0
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListPoliciesCommand) {
        listCallCount += 1
        if (listCallCount === 1) return Promise.resolve({ policies: pageOne, nextToken: 'TOKEN' })
        return Promise.resolve({ policies: pageTwo })
      }
      if (cmd instanceof DeletePolicyCommand) return Promise.resolve({})
      if (cmd instanceof CreatePolicyCommand) return Promise.resolve({ policyId: 'x' })
      throw new Error(`Unexpected command: ${cmd?.constructor.name}`)
    })

    const result = await syncTenantPolicies('ps-B')
    expect(listCallCount).toBe(2)
    expect(result.deleted).toBe(2)

    const listCalls = sendMock.mock.calls.filter((c) => c[0] instanceof ListPoliciesCommand)
    expect((listCalls[1]![0] as ListPoliciesCommand).input.nextToken).toBe('TOKEN')
  })

  it('handles an empty store (no deletes, just creates)', async () => {
    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListPoliciesCommand) return Promise.resolve({ policies: [] })
      if (cmd instanceof CreatePolicyCommand) return Promise.resolve({ policyId: 'x' })
      throw new Error(`Unexpected command for empty-store case: ${cmd?.constructor.name}`)
    })

    const result = await syncTenantPolicies('ps-empty')
    expect(result.deleted).toBe(0)
    expect(result.created).toBe(loadPolicies().length)
  })
})

describe('syncAllTenantPolicies', () => {
  it('reconciles every tenant with a non-null policyStoreId and reports per-tenant outcomes', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([
      { id: 't1', slug: 'one', policyStoreId: 'ps-1' },
      { id: 't2', slug: 'two', policyStoreId: 'ps-2' },
    ] as Awaited<ReturnType<typeof db.tenant.findMany>>)

    sendMock.mockImplementation((cmd: unknown) => {
      if (cmd instanceof ListPoliciesCommand) return Promise.resolve({ policies: [] })
      if (cmd instanceof CreatePolicyCommand) return Promise.resolve({ policyId: 'x' })
      throw new Error(`Unexpected command: ${cmd?.constructor.name}`)
    })

    const result = await syncAllTenantPolicies()
    expect(result).toEqual({
      tenantsAttempted: 2,
      tenantsSucceeded: 2,
      tenantsFailed: 0,
      failures: [],
    })
  })

  it('captures per-tenant failures into the result and keeps reconciling the rest', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([
      { id: 't1', slug: 'one', policyStoreId: 'ps-good' },
      { id: 't2', slug: 'two', policyStoreId: 'ps-bad' },
      { id: 't3', slug: 'three', policyStoreId: 'ps-good-2' },
    ] as Awaited<ReturnType<typeof db.tenant.findMany>>)

    sendMock.mockImplementation((cmd: unknown) => {
      const storeId =
        cmd instanceof ListPoliciesCommand
          ? cmd.input.policyStoreId
          : cmd instanceof CreatePolicyCommand
            ? cmd.input.policyStoreId
            : undefined
      if (storeId === 'ps-bad' && cmd instanceof ListPoliciesCommand) {
        return Promise.reject(new Error('AccessDeniedException'))
      }
      if (cmd instanceof ListPoliciesCommand) return Promise.resolve({ policies: [] })
      if (cmd instanceof CreatePolicyCommand) return Promise.resolve({ policyId: 'x' })
      throw new Error(`Unexpected command: ${cmd?.constructor.name}`)
    })

    const result = await syncAllTenantPolicies()
    expect(result.tenantsAttempted).toBe(3)
    expect(result.tenantsSucceeded).toBe(2)
    expect(result.tenantsFailed).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.policyStoreId).toBe('ps-bad')
    expect(result.failures[0]!.error).toMatch(/AccessDeniedException/)
  })

  it('returns zero counts when no tenants have policy stores', async () => {
    vi.mocked(db.tenant.findMany).mockResolvedValue([])
    const result = await syncAllTenantPolicies()
    expect(result).toEqual({
      tenantsAttempted: 0,
      tenantsSucceeded: 0,
      tenantsFailed: 0,
      failures: [],
    })
    expect(sendMock).not.toHaveBeenCalled()
  })
})
