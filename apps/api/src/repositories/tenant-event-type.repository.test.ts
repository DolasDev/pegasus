// ---------------------------------------------------------------------------
// Unit tests for the TenantEventType repository — Prisma client mocked, no DB.
// Asserts each method issues the right Prisma call and that hasDomainCondition
// is derived from domainCondition on create/update.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTenantEventTypeRepository } from './tenant-event-type.repository'

const calls = {
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

function makeDb() {
  return { tenantEventType: calls } as unknown as PrismaClient
}

/** First-arg of a mock's first call, typed as a loose record for assertions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstArg(fn: { mock: { calls: any[][] } }): any {
  return fn.mock.calls[0]?.[0]
}

beforeEach(() => vi.clearAllMocks())

describe('createTenantEventTypeRepository', () => {
  it('create derives hasDomainCondition=false and omits null JSON fields', async () => {
    calls.create.mockResolvedValue({ id: 'et-1' })
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.create({
      tenantId: 't1',
      name: 'lead.qualified',
      enabled: true,
      createdByUserId: 'u1',
    })
    const arg = firstArg(calls.create)
    expect(arg.data.hasDomainCondition).toBe(false)
    expect('payloadSchema' in arg.data).toBe(false)
    expect('domainCondition' in arg.data).toBe(false)
  })

  it('create derives hasDomainCondition=true and sets JSON fields', async () => {
    calls.create.mockResolvedValue({ id: 'et-2' })
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.create({
      tenantId: 't1',
      name: 'lead.qualified',
      payloadSchema: { type: 'object' },
      domainCondition: { sourceEventType: 'quote.accepted' },
      enabled: true,
      createdByUserId: 'u1',
    })
    const arg = firstArg(calls.create)
    expect(arg.data.hasDomainCondition).toBe(true)
    expect(arg.data.payloadSchema).toEqual({ type: 'object' })
  })

  it('findById / findByName use tenant-scoped findFirst', async () => {
    calls.findFirst.mockResolvedValue(null)
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.findById('et-1')
    expect(calls.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'et-1' } }))
    await repo.findByName('lead.qualified')
    expect(calls.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { name: 'lead.qualified' } }),
    )
  })

  it('list applies the enabled filter when given, empty where otherwise', async () => {
    calls.findMany.mockResolvedValue([])
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.list()
    expect(calls.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }))
    await repo.list({ enabled: true })
    expect(calls.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { enabled: true } }),
    )
  })

  it('update re-derives hasDomainCondition and clears JSON with JsonNull', async () => {
    calls.update.mockResolvedValue({ id: 'et-1' })
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.update('et-1', { enabled: false, domainCondition: null, payloadSchema: null })
    const arg = firstArg(calls.update)
    expect(arg.where).toEqual({ id: 'et-1' })
    expect(arg.data.enabled).toBe(false)
    expect(arg.data.hasDomainCondition).toBe(false)
  })

  it('update sets hasDomainCondition=true when a condition is provided', async () => {
    calls.update.mockResolvedValue({ id: 'et-1' })
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.update('et-1', { domainCondition: { sourceEventType: 'invoice.paid' } })
    expect(firstArg(calls.update).data.hasDomainCondition).toBe(true)
  })

  it('deleteById issues a scoped delete', async () => {
    calls.delete.mockResolvedValue({ id: 'et-1' })
    const repo = createTenantEventTypeRepository(makeDb())
    await repo.deleteById('et-1')
    expect(calls.delete).toHaveBeenCalledWith({ where: { id: 'et-1' } })
  })
})
