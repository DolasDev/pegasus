// ---------------------------------------------------------------------------
// Unit tests for the WorkflowSecretConfig repository — Prisma client mocked, no
// DB. Asserts each method issues the right Prisma call, that isSecret is derived
// from kind on create, and that the column discipline (SECRET ⇒ ciphertext;
// CONFIG ⇒ plain value) is carried through.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createWorkflowSecretConfigRepository } from './workflow-secret-config.repository'

const calls = {
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
}

function makeDb() {
  return { workflowSecretConfig: calls } as unknown as PrismaClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstArg(fn: { mock: { calls: any[][] } }): any {
  return fn.mock.calls[0]?.[0]
}

beforeEach(() => vi.clearAllMocks())

describe('createWorkflowSecretConfigRepository', () => {
  it('create for SECRET stamps isSecret=true and stores ciphertext, value null', async () => {
    calls.create.mockResolvedValue({ id: 's-1' })
    const repo = createWorkflowSecretConfigRepository(makeDb())
    await repo.create({
      tenantId: 't1',
      kind: 'SECRET',
      group: 'global',
      key: 'DB_PASSWORD',
      valueCiphertext: 'cipher==',
      createdByUserId: 'u1',
    })
    const arg = firstArg(calls.create)
    expect(arg.data.isSecret).toBe(true)
    expect(arg.data.group).toBe('global')
    expect(arg.data.valueCiphertext).toBe('cipher==')
    expect(arg.data.value).toBeNull()
  })

  it('create for CONFIG stamps isSecret=false and stores plain value, ciphertext null', async () => {
    calls.create.mockResolvedValue({ id: 'c-1' })
    const repo = createWorkflowSecretConfigRepository(makeDb())
    await repo.create({
      tenantId: 't1',
      kind: 'CONFIG',
      group: 'billing',
      key: 'REGION',
      value: 'us-east-1',
      createdByUserId: 'u1',
    })
    const arg = firstArg(calls.create)
    expect(arg.data.isSecret).toBe(false)
    expect(arg.data.group).toBe('billing')
    expect(arg.data.value).toBe('us-east-1')
    expect(arg.data.valueCiphertext).toBeNull()
  })

  it('findByKey uses tenant-scoped findFirst on (kind, group, key)', async () => {
    calls.findFirst.mockResolvedValue(null)
    const repo = createWorkflowSecretConfigRepository(makeDb())
    await repo.findByKey('SECRET', 'billing', 'DB_PASSWORD')
    expect(calls.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'SECRET', group: 'billing', key: 'DB_PASSWORD' } }),
    )
  })

  it('listByKind filters by kind (+ group when given) and orders by group then key', async () => {
    calls.findMany.mockResolvedValue([])
    const repo = createWorkflowSecretConfigRepository(makeDb())
    await repo.listByKind('CONFIG', 'billing')
    expect(calls.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'CONFIG', group: 'billing' },
        orderBy: [{ group: 'asc' }, { key: 'asc' }],
      }),
    )
  })

  it('listByKind without a group lists every group for the kind', async () => {
    calls.findMany.mockResolvedValue([])
    const repo = createWorkflowSecretConfigRepository(makeDb())
    await repo.listByKind('CONFIG')
    expect(firstArg(calls.findMany).where).toEqual({ kind: 'CONFIG' })
  })

  it('update applies only the provided fields', async () => {
    calls.update.mockResolvedValue({ id: 'c-1' })
    const repo = createWorkflowSecretConfigRepository(makeDb())
    await repo.update('c-1', { value: 'us-west-2' })
    const arg = firstArg(calls.update)
    expect(arg.where).toEqual({ id: 'c-1' })
    expect(arg.data).toEqual({ value: 'us-west-2' })
  })

  it('deleteByKey issues a tenant-scoped deleteMany and returns the count', async () => {
    calls.deleteMany.mockResolvedValue({ count: 1 })
    const repo = createWorkflowSecretConfigRepository(makeDb())
    const count = await repo.deleteByKey('SECRET', 'billing', 'DB_PASSWORD')
    expect(count).toBe(1)
    expect(calls.deleteMany).toHaveBeenCalledWith({
      where: { kind: 'SECRET', group: 'billing', key: 'DB_PASSWORD' },
    })
  })
})
