import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import {
  tunnelFetch,
  setTunnelLambdaClient,
  TunnelError,
  TunnelFetchResponse,
} from '../tunnel-client'

function fakeInvokePayload(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj))
}

beforeEach(() => {
  process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-proxy-fn'
})

afterEach(() => {
  setTunnelLambdaClient(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
})

describe('tunnelFetch', () => {
  it('invokes the configured Lambda with the request payload', async () => {
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({ status: 200, headers: {}, body: 'hi' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await tunnelFetch('https://10.200.7.1/x', {
      method: 'POST',
      headers: { 'x-h': '1' },
      body: '{"a":1}',
    })

    expect(send).toHaveBeenCalledOnce()
    const cmd = send.mock.calls[0]![0] as { input: { FunctionName: string; Payload: Uint8Array } }
    expect(cmd.input.FunctionName).toBe('test-proxy-fn')
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as Record<
      string,
      unknown
    >
    expect(payload['method']).toBe('POST')
    expect(payload['url']).toBe('https://10.200.7.1/x')
    expect(payload['headers']).toEqual({ 'x-h': '1' })
    expect(payload['body']).toBe('{"a":1}')

    expect(res).toBeInstanceOf(TunnelFetchResponse)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hi')
    expect(res.ok).toBe(true)
  })

  it('throws TUNNEL_NOT_CONFIGURED when the env var is missing', async () => {
    delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
    await expect(tunnelFetch('https://10.200.7.1/x')).rejects.toBeInstanceOf(TunnelError)
    await expect(tunnelFetch('https://10.200.7.1/x')).rejects.toMatchObject({
      code: 'TUNNEL_NOT_CONFIGURED',
    })
  })

  it('throws TUNNEL_PROXY_ERROR when the proxy Lambda reports a FunctionError', async () => {
    const send = vi.fn().mockResolvedValue({
      FunctionError: 'Unhandled',
      Payload: fakeInvokePayload({ errorMessage: 'boom' }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    await expect(tunnelFetch('https://10.200.7.1/x')).rejects.toMatchObject({
      code: 'TUNNEL_PROXY_ERROR',
    })
  })

  it('exposes upstream response via .status / .ok / .json()', async () => {
    const send = vi.fn().mockResolvedValue({
      Payload: fakeInvokePayload({
        status: 404,
        headers: { 'content-type': 'application/json' },
        body: '{"error":"nope"}',
      }),
    })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const res = await tunnelFetch('https://10.200.7.1/missing')
    expect(res.status).toBe(404)
    expect(res.ok).toBe(false)
    expect(res.headers['content-type']).toBe('application/json')
    const parsed = await res.json<{ error: string }>()
    expect(parsed.error).toBe('nope')
  })
})
