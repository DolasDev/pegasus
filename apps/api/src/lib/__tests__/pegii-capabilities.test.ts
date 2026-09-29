import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import { setTunnelLambdaClient } from '../tunnel-client'
import {
  getPegiiVersionInfo,
  requirePegiiCapabilities,
  PegiiCapabilities,
  __resetPegiiCapabilityCacheForTests,
} from '../pegii-capabilities'

function stub(status: number, body: string) {
  const send = vi.fn().mockResolvedValue({
    Payload: new TextEncoder().encode(JSON.stringify({ status, headers: {}, body })),
  })
  setTunnelLambdaClient({ send } as unknown as LambdaClient)
  return send
}

const BASE = 'http://10.200.7.1:65274'
const versionBody = (capabilities: string[]) =>
  JSON.stringify({ data: { version: '2026.9.30.1', schemaVersions: { sale: 2 }, capabilities } })

beforeEach(() => {
  process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-proxy-fn'
  __resetPegiiCapabilityCacheForTests()
})
afterEach(() => {
  setTunnelLambdaClient(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
})

describe('getPegiiVersionInfo', () => {
  it('reads the capability list without auth, and caches it per site', async () => {
    const send = stub(200, versionBody(['pegii.version.v1', 'pegii.email.v1']))
    const info = await getPegiiVersionInfo(BASE)
    expect(info).toEqual({
      version: '2026.9.30.1',
      capabilities: ['pegii.version.v1', 'pegii.email.v1'],
    })
    await getPegiiVersionInfo(BASE)
    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(
      new TextDecoder().decode(
        (send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }).input.Payload,
      ),
    ) as { url: string; headers: Record<string, string> }
    expect(payload.url).toBe(`${BASE}/api/v1/pegii/version`)
    expect(payload.headers['authorization']).toBeUndefined()
  })

  it('treats a site without /version (older build) as having no capabilities', async () => {
    stub(404, '')
    expect(await getPegiiVersionInfo(BASE)).toEqual({ version: null, capabilities: [] })
  })

  it('surfaces other failures', async () => {
    stub(500, 'boom')
    await expect(getPegiiVersionInfo(BASE)).rejects.toMatchObject({ code: 'PEGII_API_HTTP_ERROR' })
  })
})

describe('requirePegiiCapabilities', () => {
  it('passes when every capability is advertised', async () => {
    stub(200, versionBody([PegiiCapabilities.Auth, PegiiCapabilities.Email]))
    await expect(
      requirePegiiCapabilities(BASE, [PegiiCapabilities.Auth, PegiiCapabilities.Email]),
    ).resolves.toBeUndefined()
  })

  it('names the missing capabilities', async () => {
    stub(200, versionBody([PegiiCapabilities.Version]))
    await expect(requirePegiiCapabilities(BASE, [PegiiCapabilities.Email])).rejects.toMatchObject({
      code: 'PEGII_API_CAPABILITY_MISSING',
      message: expect.stringContaining('pegii.email.v1'),
    })
  })
})
