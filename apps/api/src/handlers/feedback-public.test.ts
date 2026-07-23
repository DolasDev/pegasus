// ---------------------------------------------------------------------------
// Unit tests for the PUBLIC feedback respond endpoint.
//
// The endpoint is unauthenticated (token-in-path) and uses the root db, so the
// repositories, emitDomainEvent, and the root db `$transaction` are mocked. The
// token hashing (lib/opaque-token) is NOT mocked — the test builds an auth row
// whose tokenHash is the real SHA-256 of a known token so resolution is exercised
// end to end. FEEDBACK_ENABLED is on per test.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hashToken } from '../lib/opaque-token'

const { mockReqRepo, mockFormRepo, mockEmit, mockTransaction } = vi.hoisted(() => ({
  mockReqRepo: { findByTokenPrefix: vi.fn(), recordSubmission: vi.fn() },
  mockFormRepo: { findVersionForTenant: vi.fn() },
  mockEmit: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock('../db', () => ({ db: { $transaction: mockTransaction } }))
vi.mock('../repositories/feedback-request.repository', () => ({
  createFeedbackRequestRepository: vi.fn(() => mockReqRepo),
}))
vi.mock('../repositories/feedback-form.repository', () => ({
  createFeedbackFormRepository: vi.fn(() => mockFormRepo),
}))
vi.mock('../lib/domain-events', () => ({ emitDomainEvent: mockEmit }))

import { feedbackPublicHandler } from './feedback-public'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

const TOKEN = 'fbk_' + 'b'.repeat(48)
const FUTURE = new Date(Date.now() + 3600_000)
const PAST = new Date(Date.now() - 3600_000)

function authRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'req-1',
    tenantId: 'tenant-a',
    tokenHash: hashToken(TOKEN),
    formKey: 'post-move-csat',
    formVersion: 2,
    subjectType: 'move',
    subjectId: '123',
    status: 'PENDING',
    expiresAt: FUTURE,
    ...overrides,
  }
}

const form = {
  id: 'ff-1',
  tenantId: 'tenant-a',
  formKey: 'post-move-csat',
  version: 2,
  status: 'PUBLISHED',
  title: 'CSAT',
  definition: { questions: [{ id: 'rating', type: 'rating', label: 'Rate', required: true }] },
  messageTemplate: null,
  publishedBy: 'u',
  createdAt: new Date(),
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env['FEEDBACK_ENABLED'] = 'true'
  // Default $transaction: run the callback with a fake tx client.
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({}))
})
afterEach(() => {
  delete process.env['FEEDBACK_ENABLED']
})

describe('feature gate', () => {
  it('404s when FEEDBACK_ENABLED is off', async () => {
    delete process.env['FEEDBACK_ENABLED']
    const res = await feedbackPublicHandler.request(`/feedback/${TOKEN}`)
    expect(res.status).toBe(404)
  })
})

describe('GET /feedback/:token', () => {
  it('returns status + title + definition for a valid token (no PII)', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow()])
    mockFormRepo.findVersionForTenant.mockResolvedValue(form)
    const res = await feedbackPublicHandler.request(`/feedback/${TOKEN}`)
    expect(res.status).toBe(200)
    const data = (await json(res)).data as Record<string, unknown>
    expect(data).toEqual({ status: 'pending', title: 'CSAT', definition: form.definition })
    expect(JSON.stringify(data)).not.toContain('123') // subjectId never leaks
  })

  it('404s an unknown token', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([])
    const res = await feedbackPublicHandler.request(`/feedback/${TOKEN}`)
    expect(res.status).toBe(404)
  })

  it('reports submitted / expired states', async () => {
    mockFormRepo.findVersionForTenant.mockResolvedValue(form)
    mockReqRepo.findByTokenPrefix.mockResolvedValueOnce([authRow({ status: 'SUBMITTED' })])
    let res = await feedbackPublicHandler.request(`/feedback/${TOKEN}`)
    expect(((await json(res)).data as { status: string }).status).toBe('submitted')

    mockReqRepo.findByTokenPrefix.mockResolvedValueOnce([authRow({ expiresAt: PAST })])
    res = await feedbackPublicHandler.request(`/feedback/${TOKEN}`)
    expect(((await json(res)).data as { status: string }).status).toBe('expired')
  })
})

describe('POST /feedback/:token', () => {
  it('validates, records, and emits feedback.submitted (201)', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow()])
    mockFormRepo.findVersionForTenant.mockResolvedValue(form)
    mockReqRepo.recordSubmission.mockResolvedValue(true)

    const res = await feedbackPublicHandler.request(
      `/feedback/${TOKEN}`,
      postJson({ response: { rating: 5 } }),
    )
    expect(res.status).toBe(201)
    expect(mockReqRepo.recordSubmission).toHaveBeenCalledWith('req-1', { rating: 5 })
    expect(mockEmit).toHaveBeenCalledTimes(1)
    const emitted = mockEmit.mock.calls[0]![1]
    expect(emitted).toMatchObject({
      tenantId: 'tenant-a',
      eventType: 'feedback.submitted',
      payload: {
        requestId: 'req-1',
        formKey: 'post-move-csat',
        subject: { type: 'move', id: '123' },
      },
    })
  })

  it('accepts a bare response object (no `response` wrapper)', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow()])
    mockFormRepo.findVersionForTenant.mockResolvedValue(form)
    mockReqRepo.recordSubmission.mockResolvedValue(true)
    const res = await feedbackPublicHandler.request(`/feedback/${TOKEN}`, postJson({ rating: 3 }))
    expect(res.status).toBe(201)
    expect(mockReqRepo.recordSubmission).toHaveBeenCalledWith('req-1', { rating: 3 })
  })

  it('400s an invalid response and emits nothing', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow()])
    mockFormRepo.findVersionForTenant.mockResolvedValue(form)
    const res = await feedbackPublicHandler.request(
      `/feedback/${TOKEN}`,
      postJson({ response: { rating: 99 } }),
    )
    expect(res.status).toBe(400)
    expect(mockReqRepo.recordSubmission).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('409s an already-submitted request', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow({ status: 'SUBMITTED' })])
    const res = await feedbackPublicHandler.request(
      `/feedback/${TOKEN}`,
      postJson({ response: { rating: 5 } }),
    )
    expect(res.status).toBe(409)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('410s an expired link', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow({ expiresAt: PAST })])
    const res = await feedbackPublicHandler.request(
      `/feedback/${TOKEN}`,
      postJson({ response: { rating: 5 } }),
    )
    expect(res.status).toBe(410)
  })

  it('409s (no emit) when it loses the single-submit race', async () => {
    mockReqRepo.findByTokenPrefix.mockResolvedValue([authRow()])
    mockFormRepo.findVersionForTenant.mockResolvedValue(form)
    mockReqRepo.recordSubmission.mockResolvedValue(false) // another submit landed first
    const res = await feedbackPublicHandler.request(
      `/feedback/${TOKEN}`,
      postJson({ response: { rating: 5 } }),
    )
    expect(res.status).toBe(409)
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
