// ---------------------------------------------------------------------------
// Unit tests for the FeedbackRequest repository — Prisma client mocked, no DB.
// Asserts mint issues a create with a hashed token (never the plaintext), the
// token lookups query by prefix, and recordSubmission enforces single-submit by
// only matching a still-PENDING row.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createFeedbackRequestRepository } from './feedback-request.repository'
import { hashToken } from '../lib/opaque-token'

const calls = {
  create: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}

function makeDb() {
  return { feedbackRequest: calls } as unknown as PrismaClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstArg(fn: { mock: { calls: any[][] } }): any {
  return fn.mock.calls[0]?.[0]
}

beforeEach(() => vi.clearAllMocks())

describe('createFeedbackRequestRepository', () => {
  it('mint stores a hashed token + prefix (never the plaintext) and returns the plaintext once', async () => {
    calls.create.mockResolvedValue({ id: 'req-1' })
    const repo = createFeedbackRequestRepository(makeDb())
    const { plainToken } = await repo.mint({
      tenantId: 't1',
      formKey: 'k',
      formVersion: 2,
      subjectType: 'move',
      subjectId: '123',
      expiresAt: new Date('2026-07-25T00:00:00Z'),
    })
    expect(plainToken).toMatch(/^fbk_[0-9a-f]{48}$/)
    const data = firstArg(calls.create).data
    expect(data.tokenHash).toBe(hashToken(plainToken))
    expect(data.tokenPrefix).toBe(plainToken.slice(0, 12))
    expect(data.formVersion).toBe(2)
    // The plaintext is never persisted.
    expect(JSON.stringify(data)).not.toContain(plainToken)
  })

  it('findById queries by id', async () => {
    calls.findFirst.mockResolvedValue(null)
    const repo = createFeedbackRequestRepository(makeDb())
    await repo.findById('req-1')
    expect(firstArg(calls.findFirst).where).toEqual({ id: 'req-1' })
  })

  it('findByTokenPrefix queries by the prefix (auth path)', async () => {
    calls.findMany.mockResolvedValue([])
    const repo = createFeedbackRequestRepository(makeDb())
    await repo.findByTokenPrefix('fbk_abcd1234')
    expect(firstArg(calls.findMany).where).toEqual({ tokenPrefix: 'fbk_abcd1234' })
  })

  it('recordSubmission only matches a PENDING row and reports whether it won the race', async () => {
    calls.updateMany.mockResolvedValueOnce({ count: 1 })
    const repo = createFeedbackRequestRepository(makeDb())
    const won = await repo.recordSubmission('req-1', { rating: 5 })
    expect(won).toBe(true)
    expect(firstArg(calls.updateMany).where).toEqual({ id: 'req-1', status: 'PENDING' })
    expect(firstArg(calls.updateMany).data).toMatchObject({
      status: 'SUBMITTED',
      responsePayload: { rating: 5 },
    })

    calls.updateMany.mockResolvedValueOnce({ count: 0 })
    const lost = await repo.recordSubmission('req-1', { rating: 5 })
    expect(lost).toBe(false)
  })
})
