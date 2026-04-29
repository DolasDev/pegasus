import { describe, it, expect, vi } from 'vitest'
import { proxy, type ProxyRequest } from '../index'

function mockResponse(init: {
  status?: number
  headers?: Record<string, string>
  body?: string
}): Response {
  return new Response(init.body ?? '', {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  })
}

describe('tunnel proxy', () => {
  it('forwards method, url, headers, body to fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse({ status: 200, body: 'ok' }))
    await proxy(
      {
        method: 'POST',
        url: 'https://10.200.7.1/hello',
        headers: { 'x-tenant': 'abc' },
        body: '{"a":1}',
      },
      fetchImpl as unknown as typeof fetch,
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://10.200.7.1/hello',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-tenant': 'abc' },
        body: '{"a":1}',
      }),
    )
  })

  it('returns the upstream status, body, and flattened headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse({
        status: 418,
        body: 'teapot',
        headers: { 'content-type': 'text/plain', 'x-custom': 'yes' },
      }),
    )
    const res = await proxy(
      { method: 'GET', url: 'https://10.200.7.1/tea' },
      fetchImpl as unknown as typeof fetch,
    )
    expect(res.status).toBe(418)
    expect(res.body).toBe('teapot')
    expect(res.headers['content-type']).toBe('text/plain')
    expect(res.headers['x-custom']).toBe('yes')
  })

  it('throws when method or url is missing', async () => {
    const fetchImpl = vi.fn()
    await expect(
      proxy(
        { method: '', url: 'x' } as unknown as ProxyRequest,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a 504 ProxyResponse when timeoutMs elapses', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        )
      })
    })
    const p = proxy(
      { method: 'GET', url: 'https://10.200.7.1/slow', timeoutMs: 1000 },
      fetchImpl as unknown as typeof fetch,
    )
    vi.advanceTimersByTime(1000)
    const res = await p
    vi.useRealTimers()
    expect(res.status).toBe(504)
    expect(res.headers['x-tunnel-proxy-error']).toBe('TUNNEL_TIMEOUT')
    const parsed = JSON.parse(res.body) as { code: string; url: string }
    expect(parsed.code).toBe('TUNNEL_TIMEOUT')
    expect(parsed.url).toBe('https://10.200.7.1/slow')
  })

  it('returns a 502 ProxyResponse on a non-timeout fetch failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED 10.200.7.1:3000'), { name: 'TypeError' }),
      )
    const res = await proxy(
      { method: 'GET', url: 'http://10.200.7.1:3000/ping' },
      fetchImpl as unknown as typeof fetch,
    )
    expect(res.status).toBe(502)
    expect(res.headers['x-tunnel-proxy-error']).toBe('TUNNEL_NETWORK_ERROR')
    const parsed = JSON.parse(res.body) as { code: string; error: string }
    expect(parsed.code).toBe('TUNNEL_NETWORK_ERROR')
    expect(parsed.error).toContain('ECONNREFUSED')
  })
})
