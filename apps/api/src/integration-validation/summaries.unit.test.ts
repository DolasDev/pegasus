/**
 * Unit tests for the summaries read model's defensive paths — the ones a
 * DB-backed test cannot reach on demand: the tenant-id lookup failing, and a
 * published row that exists but cannot be trusted. No database; the config
 * repository is mocked so both failures can be provoked deliberately.
 *
 * The happy paths (which ids get listed, for whom) are covered against a real
 * database in summaries.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mockRepo = vi.hoisted(() => ({
  listActiveGlobal: vi.fn(async () => [] as unknown[]),
  listActiveIntegrationIdsForTenant: vi.fn(async () => [] as string[]),
  findActiveForScope: vi.fn(async (_integrationId: string) => null as unknown),
}))

vi.mock('../repositories/integration-config.repository', () => ({
  createIntegrationConfigRepository: vi.fn(() => mockRepo),
}))

import { listIntegrationIdsForScope } from './registry'
import { listIntegrationSummaries } from './summaries'

const fakeDb = {} as unknown as PrismaClient
const TENANT = 'tenant-1'

describe('listIntegrationIdsForScope (defensive)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.listActiveGlobal.mockResolvedValue([])
    mockRepo.listActiveIntegrationIdsForTenant.mockResolvedValue([])
    mockRepo.findActiveForScope.mockResolvedValue(null)
  })

  it('fails open to the built-ins when the tenant id lookup throws', async () => {
    mockRepo.listActiveIntegrationIdsForTenant.mockRejectedValue(new Error('db down'))
    const ids = await listIntegrationIdsForScope(fakeDb, TENANT)
    // Degraded, not broken: the page still renders the code baseline.
    expect(ids).toContain('demo_partner')
    expect(ids).toContain('allied_status')
  })

  it('fails open just as safely when the lookup rejects with a non-Error', async () => {
    mockRepo.listActiveIntegrationIdsForTenant.mockRejectedValue('db down')
    const ids = await listIntegrationIdsForScope(fakeDb, TENANT)
    expect(ids).toContain('demo_partner')
  })

  it("adds the tenant's own ids to the built-ins", async () => {
    mockRepo.listActiveIntegrationIdsForTenant.mockResolvedValue(['my_partner'])
    const ids = await listIntegrationIdsForScope(fakeDb, TENANT)
    expect(ids).toContain('my_partner')
    expect(ids).toContain('demo_partner')
  })
})

describe('listIntegrationSummaries (defensive)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.listActiveGlobal.mockResolvedValue([])
    mockRepo.listActiveIntegrationIdsForTenant.mockResolvedValue([])
    mockRepo.findActiveForScope.mockResolvedValue(null)
  })

  it('falls back to the built-in definition when the active row cannot be parsed', async () => {
    // A row whose mapping is not a valid template: it is still the ACTIVE config
    // (so the id reads as published), but its display metadata has to come from
    // the built-in, exactly as the runtime resolver falls back for validation.
    mockRepo.findActiveForScope.mockImplementation(async (id: string) =>
      id === 'demo_partner'
        ? { integrationId: id, version: 9, visibility: 'TENANT', mapping: 42, rules: 'nope' }
        : null,
    )
    const summaries = await listIntegrationSummaries(fakeDb, TENANT)
    const demo = summaries.find((s) => s.id === 'demo_partner')
    expect(demo).toMatchObject({
      name: 'Demo Partner',
      published: true,
      version: 9,
      visibility: 'TENANT',
    })
  })

  it('skips an id whose only definition would come from an untrusted row', async () => {
    mockRepo.listActiveIntegrationIdsForTenant.mockResolvedValue(['ghost'])
    mockRepo.findActiveForScope.mockImplementation(async (id: string) =>
      id === 'ghost'
        ? // Unknown floor + no built-in ⇒ unresolvable; it can never take effect.
          {
            integrationId: id,
            version: 1,
            visibility: 'TENANT',
            mapping: {},
            rules: [],
            floor: 'no_such_floor',
          }
        : null,
    )
    const summaries = await listIntegrationSummaries(fakeDb, TENANT)
    expect(summaries.find((s) => s.id === 'ghost')).toBeUndefined()
    // …without taking the rest of the list down with it.
    expect(summaries.find((s) => s.id === 'demo_partner')).toBeDefined()
  })
})
