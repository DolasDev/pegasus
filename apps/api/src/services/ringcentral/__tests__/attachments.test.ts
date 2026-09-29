import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  acquireAccessToken: vi.fn(),
  invalidateToken: vi.fn(),
}))

vi.mock('../client', async (importActual) => {
  const actual = await importActual<typeof ClientModule>()
  return {
    ...actual,
    acquireAccessToken: h.acquireAccessToken,
    invalidateToken: h.invalidateToken,
  }
})

import { fetchAttachmentContent } from '../attachments'
import { RateLimitError } from '../client'
import type * as ClientModule from '../client'

const conn = (id: string, acct: string, ext: string) => ({
  id,
  tokenSecretArn: `arn:${id}`,
  rcAccountId: acct,
  rcExtensionId: ext,
})

const bytes = (n: number) => new Uint8Array(n).fill(7)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.acquireAccessToken.mockReset()
  h.invalidateToken.mockReset()
  h.acquireAccessToken.mockResolvedValue({
    accessToken: 'at',
    apiBase: 'https://platform.ringcentral.com',
  })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('fetchAttachmentContent', () => {
  it("fetches the file from the connection's message store by message + attachment id", async () => {
    fetchMock.mockResolvedValue(
      new Response(bytes(5), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )

    const got = await fetchAttachmentContent([conn('c1', '111', '222')], '3616791452016', '2')

    expect(got).toEqual({ contentType: 'image/jpeg', bytes: expect.any(Uint8Array) })
    expect(got?.bytes.byteLength).toBe(5)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(
      'https://platform.ringcentral.com/restapi/v1.0/account/111/extension/222/message-store/3616791452016/content/2',
    )
    expect(init.headers).toMatchObject({ Authorization: 'Bearer at' })
  })

  it('tries each connection until one holds the message', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(bytes(3), { status: 200, headers: { 'content-type': 'image/png' } }),
      )

    const got = await fetchAttachmentContent(
      [conn('c1', '111', '222'), conn('c2', '333', '444')],
      '9',
      '2',
    )

    expect(got?.contentType).toBe('image/png')
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/account/333/extension/444/')
  })

  it('returns null when no connection has it', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }))
    expect(await fetchAttachmentContent([conn('c1', '1', '2')], '9', '2')).toBeNull()
  })

  it('re-mints the token once on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(bytes(1), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      )

    const got = await fetchAttachmentContent([conn('c1', '1', '2')], '9', '2')

    expect(h.invalidateToken).toHaveBeenCalledWith('c1')
    expect(h.acquireAccessToken).toHaveBeenCalledTimes(2)
    expect(got?.bytes.byteLength).toBe(1)
  })

  it('surfaces RingCentral rate limiting as RateLimitError', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }),
    )
    await expect(fetchAttachmentContent([conn('c1', '1', '2')], '9', '2')).rejects.toBeInstanceOf(
      RateLimitError,
    )
  })

  it('throws on any other upstream failure', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))
    await expect(fetchAttachmentContent([conn('c1', '1', '2')], '9', '2')).rejects.toThrow(
      /RingCentral attachment fetch failed: 500/,
    )
  })

  it('defaults the content type when RingCentral omits it', async () => {
    fetchMock.mockResolvedValue(new Response(bytes(1), { status: 200 }))
    const got = await fetchAttachmentContent([conn('c1', '1', '2')], '9', '2')
    expect(got?.contentType).toBe('application/octet-stream')
  })
})
