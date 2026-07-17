// ---------------------------------------------------------------------------
// Unit tests for the PUBLIC ingress endpoint (sdk-feedback 0021) — the flagship
// acceptance criteria: bearer auth (resolves tenant), synchronous partner-shaped
// ack from ingestion, dedup on the external id, emit-a-domain-event, malformed
// -> Failed. The root db + credential repo are mocked; auth uses a real hash.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

const { mockFindByPrefix, mockConfigFindFirst, mockTx, mockTransaction } = vi.hoisted(() => {
  const tx = { domainEvent: { create: vi.fn() }, inboundEvent: { create: vi.fn() } }
  return {
    mockFindByPrefix: vi.fn(),
    mockConfigFindFirst: vi.fn(),
    mockTx: tx,
    mockTransaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
})

vi.mock('../db', () => ({
  db: {
    integrationConfig: { findFirst: mockConfigFindFirst },
    $transaction: mockTransaction,
  },
}))
vi.mock('../repositories/ingress-credential.repository', () => ({
  createIngressCredentialRepository: () => ({ findByTokenPrefix: mockFindByPrefix }),
}))

import { ingressHandler } from './ingress'

const TOKEN = 'ing_0123456789abcdef0123456789abcdef0123456789abcdef'
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex')
const INTEGRATION = 'sirva_ade_shipment'
const ROUTE = `/integrations/${INTEGRATION}/events`

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>
function req(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }
}
const auth = { Authorization: `Bearer ${TOKEN}` }

// An ADE-style inbound block published on the tenant's IntegrationConfig.
const ADE_INBOUND = {
  eventType: 'sirva_ade.shipment.event',
  dedupKeyPath: 'Events.0.Id',
  ackTemplate: {
    success: { Result: { Results: 'Success', ResultsMessageCount: 0, ResultsMessage: [] } },
    failure: {
      Result: {
        Results: 'Failed',
        ResultsMessageCount: '{{errorCount}}',
        ResultsMessage: '{{messages}}',
      },
    },
  },
}

function app() {
  const a = new Hono<AppEnv>()
  registerTestErrorHandler(a)
  a.route('/', ingressHandler)
  return a
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindByPrefix.mockResolvedValue([
    {
      id: 'cred-1',
      tenantId: 'tenant-1',
      integrationId: INTEGRATION,
      tokenHash: TOKEN_HASH,
      enabled: true,
    },
  ])
  mockConfigFindFirst.mockResolvedValue({ inbound: ADE_INBOUND })
  mockTransaction.mockImplementation(async (fn: (t: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx),
  )
  mockTx.domainEvent.create.mockResolvedValue({ id: 'evt-1' })
  mockTx.inboundEvent.create.mockResolvedValue({ id: 'ib-1' })
})

const SHIPMENT = { SvcProvDataRecipient: 'agent', Events: [{ Id: 'E-100', Type: 'Loaded' }] }

describe('POST /integrations/:id/events', () => {
  it('401 — missing bearer', async () => {
    const res = await app().request(ROUTE, req(SHIPMENT))
    expect(res.status).toBe(401)
    expect(mockTx.domainEvent.create).not.toHaveBeenCalled()
  })

  it('401 — wrong token (hash mismatch)', async () => {
    const res = await app().request(
      ROUTE,
      req(SHIPMENT, { Authorization: 'Bearer ing_wrongwrongwrong' }),
    )
    expect(res.status).toBe(401)
  })

  it('401 — token for a different integration', async () => {
    mockFindByPrefix.mockResolvedValue([
      { id: 'c', tenantId: 't', integrationId: 'other', tokenHash: TOKEN_HASH, enabled: true },
    ])
    const res = await app().request(ROUTE, req(SHIPMENT, auth))
    expect(res.status).toBe(401)
  })

  it('200 — valid token: synchronous ADE Success ack + a domain event emitted', async () => {
    const res = await app().request(ROUTE, req(SHIPMENT, auth))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      Result: { Results: 'Success', ResultsMessageCount: 0, ResultsMessage: [] },
    })
    // Emitted the configured domain event carrying the raw payload.
    expect(mockTx.domainEvent.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', eventType: 'sirva_ade.shipment.event', payload: SHIPMENT },
      select: { id: true },
    })
    // Persisted the raw payload + dedup id (from Events.0.Id) + back-link.
    const ibArg = mockTx.inboundEvent.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(ibArg.data).toMatchObject({
      tenantId: 'tenant-1',
      integrationId: INTEGRATION,
      externalId: 'E-100',
      status: 'accepted',
      domainEventId: 'evt-1',
    })
  })

  it('200 — redelivery of the same event id is deduped (Success ack, no second emit)', async () => {
    mockTx.inboundEvent.create.mockRejectedValue({ code: 'P2002' }) // unique violation
    const res = await app().request(ROUTE, req(SHIPMENT, auth))
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ Result: { Results: 'Success' } })
    // The transaction rolls back — the workflow won't fire a second time.
  })

  it('200 — malformed body returns the ADE Failed envelope, no emit', async () => {
    const res = await app().request(ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: '{not valid json',
    })
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      Result: {
        Results: 'Failed',
        ResultsMessageCount: 1,
        ResultsMessage: ['malformed request body'],
      },
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('200 — a body that fails the published validation returns the ADE Failed envelope with per-message objects, no emit', async () => {
    // An inbound block with a validation block + a $map failure template (the full
    // ADE Result{Results:"Failed", ResultsMessage:[{Code,Description}]} envelope).
    mockConfigFindFirst.mockResolvedValue({
      inbound: {
        eventType: 'sirva_ade.shipment.event',
        dedupKeyPath: 'Events.0.Id',
        validation: { requiredPaths: ['SvcProvDataRecipient'], nonEmptyArrayPaths: ['Events'] },
        ackTemplate: {
          success: { Result: { Results: 'Success', ResultsMessageCount: 0, ResultsMessage: [] } },
          failure: {
            Result: {
              Results: '{{status}}',
              ResultsMessageCount: '{{errorCount}}',
              ResultsMessage: {
                $map: 'issues',
                as: { ResultsMessageCode: '{{code}}', ResultsMessageDescription: '{{message}}' },
              },
            },
          },
        },
      },
    })
    // Missing SvcProvDataRecipient AND an empty Events array → two issues.
    const res = await app().request(ROUTE, req({ Events: [] }, auth))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      Result: {
        Results: 'Failed',
        ResultsMessageCount: 2,
        ResultsMessage: [
          {
            ResultsMessageCode: 'MISSING_FIELD',
            ResultsMessageDescription: 'Required field "SvcProvDataRecipient" is missing.',
          },
          {
            ResultsMessageCode: 'EMPTY_LIST',
            ResultsMessageDescription: '"Events" must be a non-empty array.',
          },
        ],
      },
    })
    // Rejected at validation — nothing persisted or emitted.
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('200 — a valid body passes validation and emits (Success ack)', async () => {
    mockConfigFindFirst.mockResolvedValue({
      inbound: {
        ...ADE_INBOUND,
        validation: { requiredPaths: ['SvcProvDataRecipient'], nonEmptyArrayPaths: ['Events'] },
      },
    })
    const res = await app().request(ROUTE, req(SHIPMENT, auth))
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ Result: { Results: 'Success' } })
    expect(mockTx.domainEvent.create).toHaveBeenCalled()
  })

  it('200 — generic ack when the integration publishes no inbound block', async () => {
    mockConfigFindFirst.mockResolvedValue(null)
    const res = await app().request(ROUTE, req(SHIPMENT, auth))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ status: 'accepted' })
    // Falls back to the default event type <integrationId>.inbound.received.
    expect(mockTx.domainEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'sirva_ade_shipment.inbound.received' }),
      }),
    )
  })
})
