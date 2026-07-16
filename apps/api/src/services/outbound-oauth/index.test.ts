// ---------------------------------------------------------------------------
// Unit tests for the generic outbound OAuth2 client-credentials token cache.
// No network: `fetchImpl` and `now` are injected. Covers JSON + XML token
// parsing, the 60s-skew cache, re-mint on expiry / invalidate, and errors.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  acquireOutboundToken,
  invalidateOutboundToken,
  outboundTokenCacheKey,
  parseAccessToken,
  OutboundOAuthError,
  __resetOutboundTokenCacheForTests,
} from './index'

const CFG = {
  tokenUrl: 'https://partner.example.com/oauth2/accessrequest',
  clientId: 'id',
  clientSecret: 'sec',
}
const KEY = outboundTokenCacheKey('t1', 'sirva_ade_shipment', CFG.tokenUrl)

const okRes = (body: string, contentType = 'application/json'): Response =>
  ({
    ok: true,
    status: 200,
    text: async () => body,
    headers: new Headers({ 'content-type': contentType }),
  }) as unknown as Response

beforeEach(() => {
  __resetOutboundTokenCacheForTests()
})

describe('parseAccessToken', () => {
  it('parses a JSON token body', () => {
    const p = parseAccessToken(
      JSON.stringify({ access_token: 'AAA', expires_in: 600, token_type: 'Bearer' }),
      'application/json',
    )
    expect(p).toEqual({ accessToken: 'AAA', expiresIn: 600, tokenType: 'Bearer' })
  })

  it('parses the ADE XML <Access> body (token is not JSON)', () => {
    const xml =
      '<Access xmlns="http://schemas.datacontract.org/2004/07/OAuth2.Models">' +
      '<access_token>XML-TOK</access_token><expires_in>600</expires_in><token_type>Bearer</token_type></Access>'
    const p = parseAccessToken(xml, 'application/xml')
    expect(p).toEqual({ accessToken: 'XML-TOK', expiresIn: 600, tokenType: 'Bearer' })
  })

  it('returns null when there is no access_token', () => {
    expect(parseAccessToken('<Access></Access>', 'application/xml')).toBeNull()
    expect(parseAccessToken('{}', 'application/json')).toBeNull()
  })
})

describe('acquireOutboundToken', () => {
  it('mints via Basic base64(id:secret) + grant_type=client_credentials and caches', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
    const tok = await acquireOutboundToken(KEY, CFG, { now: 1_000, fetchImpl })
    expect(tok).toBe('TOK1')
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CFG.tokenUrl)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('id:sec').toString('base64')}`,
    )
    expect(init.body).toBe('grant_type=client_credentials')

    // Second call inside the token's life → served from cache, no new mint.
    const tok2 = await acquireOutboundToken(KEY, CFG, { now: 2_000, fetchImpl })
    expect(tok2).toBe('TOK1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-mints once the cached token is within 60s of expiry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK2', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl }) // expiresAt = 600_000
    const again = await acquireOutboundToken(KEY, CFG, { now: 600_000 - 30_000, fetchImpl }) // within 60s skew
    expect(again).toBe('TOK2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('invalidateOutboundToken forces a re-mint (the 401 recovery path)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK1', expires_in: 600 })))
      .mockResolvedValueOnce(okRes(JSON.stringify({ access_token: 'TOK2', expires_in: 600 })))
    await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })
    invalidateOutboundToken(KEY)
    const fresh = await acquireOutboundToken(KEY, CFG, { now: 1_000, fetchImpl })
    expect(fresh).toBe('TOK2')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('parses an XML token response end-to-end', async () => {
    const xml =
      '<Access><access_token>XT</access_token><expires_in>600</expires_in><token_type>Bearer</token_type></Access>'
    const fetchImpl = vi.fn().mockResolvedValue(okRes(xml, 'application/xml'))
    expect(await acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })).toBe('XT')
  })

  it('throws OutboundOAuthError on a non-2xx token endpoint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'bad creds',
        headers: new Headers(),
      } as unknown as Response)
    await expect(acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('throws OutboundOAuthError(502) when the token endpoint is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(acquireOutboundToken(KEY, CFG, { now: 0, fetchImpl })).rejects.toBeInstanceOf(
      OutboundOAuthError,
    )
  })
})
