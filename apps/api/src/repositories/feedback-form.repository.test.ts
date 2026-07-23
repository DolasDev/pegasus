// ---------------------------------------------------------------------------
// Unit tests for the FeedbackForm repository — Prisma client mocked, no DB.
// Asserts each method issues the right Prisma call and that publish computes the
// next version + supersedes the prior PUBLISHED row in one transaction.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createFeedbackFormRepository } from './feedback-form.repository'

const calls = {
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}

function makeDb() {
  const db = { feedbackForm: calls } as unknown as PrismaClient
  ;(db as unknown as { $transaction: unknown }).$transaction = vi.fn(
    (cb: (tx: unknown) => unknown) => cb(db),
  )
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstArg(fn: { mock: { calls: any[][] } }): any {
  return fn.mock.calls[0]?.[0]
}

beforeEach(() => vi.clearAllMocks())

describe('createFeedbackFormRepository', () => {
  it('publish computes next version, supersedes prior PUBLISHED, inserts new row', async () => {
    calls.aggregate.mockResolvedValue({ _max: { version: 2 } })
    calls.create.mockResolvedValue({ id: 'ff-1', version: 3 })
    const repo = createFeedbackFormRepository(makeDb())
    await repo.publish({
      tenantId: 't1',
      formKey: 'post-move-csat',
      title: 'CSAT',
      definition: { questions: [] },
      publishedBy: 'u1',
    })
    expect(firstArg(calls.updateMany).where).toMatchObject({
      tenantId: 't1',
      formKey: 'post-move-csat',
      status: 'PUBLISHED',
    })
    expect(firstArg(calls.updateMany).data).toEqual({ status: 'SUPERSEDED' })
    const created = firstArg(calls.create).data
    expect(created).toMatchObject({ version: 3, status: 'PUBLISHED', messageTemplate: null })
  })

  it('publish defaults version to 1 when no prior rows exist', async () => {
    calls.aggregate.mockResolvedValue({ _max: { version: null } })
    calls.create.mockResolvedValue({ id: 'ff-1', version: 1 })
    const repo = createFeedbackFormRepository(makeDb())
    await repo.publish({
      tenantId: 't1',
      formKey: 'k',
      title: 'T',
      definition: {},
      messageTemplate: 'hi {{url}}',
      publishedBy: 'u1',
    })
    expect(firstArg(calls.create).data).toMatchObject({ version: 1, messageTemplate: 'hi {{url}}' })
  })

  it('findActive queries the latest PUBLISHED row for a key', async () => {
    calls.findFirst.mockResolvedValue({ id: 'ff-1' })
    const repo = createFeedbackFormRepository(makeDb())
    await repo.findActive('k')
    expect(firstArg(calls.findFirst)).toMatchObject({
      where: { formKey: 'k', status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    })
  })

  it('listActive lists PUBLISHED rows', async () => {
    calls.findMany.mockResolvedValue([])
    const repo = createFeedbackFormRepository(makeDb())
    await repo.listActive()
    expect(firstArg(calls.findMany).where).toEqual({ status: 'PUBLISHED' })
  })

  it('listVersions lists every version newest-first', async () => {
    calls.findMany.mockResolvedValue([])
    const repo = createFeedbackFormRepository(makeDb())
    await repo.listVersions('k')
    expect(firstArg(calls.findMany)).toMatchObject({
      where: { formKey: 'k' },
      orderBy: { version: 'desc' },
    })
  })

  it('findVersion queries a specific (key, version)', async () => {
    calls.findFirst.mockResolvedValue(null)
    const repo = createFeedbackFormRepository(makeDb())
    await repo.findVersion('k', 2)
    expect(firstArg(calls.findFirst).where).toEqual({ formKey: 'k', version: 2 })
  })

  it('findVersionForTenant scopes by tenantId explicitly (root-db path)', async () => {
    calls.findFirst.mockResolvedValue(null)
    const repo = createFeedbackFormRepository(makeDb())
    await repo.findVersionForTenant('t1', 'k', 2)
    expect(firstArg(calls.findFirst).where).toEqual({ tenantId: 't1', formKey: 'k', version: 2 })
  })
})
