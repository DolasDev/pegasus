import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../../types'

const h = vi.hoisted(() => {
  class RateLimitError extends Error {
    constructor(public readonly retryAfterMs: number) {
      super('rate limited')
    }
  }
  return {
    RateLimitError,
    listConnectionsByTenant: vi.fn(),
    fetchAttachmentContent: vi.fn(),
    requirePermission: vi.fn(),
  }
})

vi.mock('../../../middleware/rbac', () => ({
  requirePermission: (action: unknown) => {
    h.requirePermission(action)
    return (_c: unknown, next: () => unknown) => next()
  },
}))
vi.mock('../../../repositories/messaging.repository', () => ({
  listConnectionsByTenant: h.listConnectionsByTenant,
}))
vi.mock('../../../services/ringcentral/attachments', () => ({
  fetchAttachmentContent: h.fetchAttachmentContent,
}))
vi.mock('../../../services/ringcentral/client', () => ({ RateLimitError: h.RateLimitError }))

import { ringcentralAttachmentsHandler } from '../ringcentral-attachments'
import { Actions } from '../../../authz/actions'

// Captured at import, when the route registers its middleware (beforeEach resets mocks).
const gatedWith = h.requirePermission.mock.calls.map((c) => c[0])

function app(tenantId = 'tnt-1') {
  const a = new Hono<AppEnv>()
  a.use('*', async (c, next) => {
    c.set('tenantId', tenantId)
    c.set('db', {} as never)
    await next()
  })
  a.route('/', ringcentralAttachmentsHandler)
  return a
}

const PATH = '/messages/V1_STORE/3616791452016/attachments/2'
const CONN = {
  id: 'c1',
  tokenSecretArn: 'arn',
  rcAccountId: '111',
  rcExtensionId: '222',
  tenantId: 'tnt-1',
}

beforeEach(() => {
  Object.values(h).forEach((v) => typeof v === 'function' && 'mockReset' in v && v.mockReset())
  h.listConnectionsByTenant.mockResolvedValue([CONN])
  h.fetchAttachmentContent.mockResolvedValue({
    contentType: 'image/jpeg',
    bytes: new Uint8Array([1, 2, 3]),
  })
})

describe('GET /messages/:source/:externalId/attachments/:attachmentId', () => {
  it('is gated by ReadRingCentralAttachment', () => {
    expect(gatedWith).toEqual([Actions.ReadRingCentralAttachment])
  })

  it("returns the file as a base64 JSON envelope by default, via the tenant's connections", async () => {
    const res = await app().request(PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: {
        source: 'V1_STORE',
        externalId: '3616791452016',
        attachmentId: '2',
        contentType: 'image/jpeg',
        sizeBytes: 3,
        contentBase64: Buffer.from([1, 2, 3]).toString('base64'),
      },
    })
    expect(h.listConnectionsByTenant).toHaveBeenCalledWith(expect.anything(), 'tnt-1')
    expect(h.fetchAttachmentContent).toHaveBeenCalledWith([CONN], '3616791452016', '2')
  })

  it('returns raw bytes with ?format=raw', async () => {
    const res = await app().request(`${PATH}?format=raw`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('never passes an active content type through in raw mode', async () => {
    h.fetchAttachmentContent.mockResolvedValue({
      contentType: 'text/html',
      bytes: new Uint8Array([60]),
    })
    const res = await app().request(`${PATH}?format=raw`)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('rejects an unknown format', async () => {
    const res = await app().request(`${PATH}?format=png`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('UNSUPPORTED_FORMAT')
  })

  it('rejects an unsupported source and malformed ids without calling RingCentral', async () => {
    for (const path of [
      '/messages/THREAD_STORE/1/attachments/2',
      '/messages/NOPE/1/attachments/2',
      '/messages/V1_STORE/..%2F..%2Fx/attachments/2',
      '/messages/V1_STORE/1/attachments/a%20b',
    ]) {
      const res = await app().request(path)
      expect(res.status).toBe(400)
    }
    expect(h.fetchAttachmentContent).not.toHaveBeenCalled()
  })

  it('404s when the tenant has no RingCentral connection', async () => {
    h.listConnectionsByTenant.mockResolvedValue([])
    const res = await app().request(PATH)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('NO_RINGCENTRAL_CONNECTION')
  })

  it('404s when RingCentral no longer has the attachment', async () => {
    h.fetchAttachmentContent.mockResolvedValue(null)
    const res = await app().request(PATH)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('ATTACHMENT_NOT_FOUND')
  })

  it('503s with Retry-After when RingCentral rate-limits', async () => {
    h.fetchAttachmentContent.mockRejectedValue(new h.RateLimitError(30_000))
    const res = await app().request(PATH)
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
  })

  it('502s on any other upstream failure', async () => {
    h.fetchAttachmentContent.mockRejectedValue(
      new Error('RingCentral attachment fetch failed: 500'),
    )
    const res = await app().request(PATH)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { code: string }).code).toBe('UPSTREAM_ERROR')
  })

  it('refuses a file too large to return through the API', async () => {
    h.fetchAttachmentContent.mockResolvedValue({
      contentType: 'video/3gpp',
      bytes: new Uint8Array(3_500_000),
    })
    const res = await app().request(PATH)
    expect(res.status).toBe(502)
    expect(((await res.json()) as { code: string }).code).toBe('ATTACHMENT_TOO_LARGE')
  })
})
