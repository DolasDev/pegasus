// The pegII client's choice between a cloud-issued token and the legacy credential
// path, plus x-correlation-id forwarding (cloud identity I1).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { decodeJwt } from 'jose'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import { setTunnelLambdaClient } from '../tunnel-client'
import { createPegiiApiClient, pegiiApiErrorToHttp, PegiiApiError } from '../pegii-api-client'
import { __resetPegiiCapabilityCacheForTests } from '../pegii-capabilities'
import { createPegiiTokenMinter, __setPegiiTokenMinterForTests } from '../pegii-token'
import { createLocalSigner } from '../pegii-signer'
import type { PegiiCaller } from '../pegii-request-context'

const BASE = 'http://10.200.7.1:65274'

type Upstream = { status: number; body: unknown }
type Sent = { url: string; method: string; headers: Record<string, string> }

/** Route stubbed tunnel responses by URL; `/version` and data calls answered separately. */
function stubTunnel(opts: { version: Upstream | 'throw'; data: Upstream[] }) {
  const sent: Sent[] = []
  const data = [...opts.data]
  const send = vi.fn(async (cmd: { input: { Payload: Uint8Array } }) => {
    const req = JSON.parse(new TextDecoder().decode(cmd.input.Payload)) as Sent
    sent.push(req)
    let res: Upstream
    if (req.url.endsWith('/api/v1/pegii/version')) {
      if (opts.version === 'throw') throw new Error('tunnel down')
      res = opts.version
    } else {
      res = data.shift() ?? { status: 200, body: { data: { ok: true } } }
    }
    return {
      Payload: new TextEncoder().encode(
        JSON.stringify({ status: res.status, headers: {}, body: JSON.stringify(res.body) }),
      ),
    }
  })
  setTunnelLambdaClient({ send } as unknown as LambdaClient)
  return sent
}

const versionWith = (capabilities: string[]): Upstream => ({
  status: 200,
  body: { data: { version: '1.0', capabilities } },
})

function caller(overrides: Partial<PegiiCaller> = {}): PegiiCaller {
  return {
    tenantId: 'tenant-1',
    correlationId: 'cloud-req-123',
    principal: { tenantUserId: 'svc-1', isServiceAccount: true },
    site: { id: 'site-1', cloudAuthEnabled: true },
    company: { id: 'co-1', code: 'NW', dataSourceKey: null, systemEmployeeCode: 1001 },
    ...overrides,
  }
}

const dataCalls = (sent: Sent[]) => sent.filter((s) => !s.url.endsWith('/version'))
const bearer = (s: Sent) => s.headers['authorization']?.replace(/^Bearer /, '')

beforeEach(() => {
  process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-proxy-fn'
  __resetPegiiCapabilityCacheForTests()
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  __setPegiiTokenMinterForTests(
    createPegiiTokenMinter({
      signer: createLocalSigner({ keyId: 'kid-1', privateKey }),
      issuer: 'https://issuer.test',
    }),
  )
})

afterEach(() => {
  setTunnelLambdaClient(null)
  __setPegiiTokenMinterForTests(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
})

describe('cloud-issued token selection', () => {
  it('sends a cloud token for the caller when the site advertises pegii.cloud-auth.v1', async () => {
    const sent = stubTunnel({ version: versionWith(['pegii.cloud-auth.v1']), data: [] })
    const client = createPegiiApiClient({
      tenantId: 'tenant-1',
      baseUrl: BASE,
      apiKey: 'legacy-raw-key',
      caller: caller(),
    })

    await client.get('/api/v1/pegii/orders/search')

    const claims = decodeJwt(bearer(dataCalls(sent)[0]!)!)
    expect(claims).toMatchObject({
      aud: 'pegii-site:site-1',
      sub: 'svc-1',
      tid: 'tenant-1',
      ptype: 'service',
      emp: 1001,
    })
    expect(claims).not.toHaveProperty('cid')
  })

  it('keeps the legacy credential when the site lacks cloud-auth', async () => {
    const sent = stubTunnel({ version: versionWith(['pegii.auth.v1']), data: [] })
    const client = createPegiiApiClient({
      tenantId: 'tenant-1',
      baseUrl: BASE,
      apiKey: 'legacy-raw-key',
      caller: caller(),
    })

    await client.get('/x')

    expect(bearer(dataCalls(sent)[0]!)).toBe('legacy-raw-key')
  })

  it('never probes or mints while the site operator switch is off, even if /version would advertise cloud-auth', async () => {
    // A spoofed or stale /version must not be able to initiate the cloud path.
    const sent = stubTunnel({ version: versionWith(['pegii.cloud-auth.v1']), data: [] })
    const client = createPegiiApiClient({
      tenantId: 'tenant-1',
      baseUrl: BASE,
      apiKey: 'legacy-raw-key',
      caller: caller({ site: { id: 'site-1', cloudAuthEnabled: false } }),
    })

    await client.get('/x')

    expect(sent.map((s) => s.url)).toEqual([`${BASE}/x`])
    expect(bearer(sent[0]!)).toBe('legacy-raw-key')
    expect(sent[0]!.headers['x-correlation-id']).toBe('cloud-req-123')
  })

  it('falls back to the legacy credential when the /version probe fails', async () => {
    const sent = stubTunnel({ version: 'throw', data: [] })
    const client = createPegiiApiClient({
      tenantId: 'tenant-1',
      baseUrl: BASE,
      apiKey: 'legacy-raw-key',
      caller: caller(),
    })

    await client.get('/x')

    expect(bearer(dataCalls(sent)[0]!)).toBe('legacy-raw-key')
  })

  it('does not probe /version at all without a caller (unchanged legacy behaviour)', async () => {
    const sent = stubTunnel({ version: versionWith(['pegii.cloud-auth.v1']), data: [] })
    const client = createPegiiApiClient({ tenantId: 't', baseUrl: BASE, apiKey: 'k' })

    await client.get('/x')

    expect(sent.map((s) => s.url)).toEqual([`${BASE}/x`])
    expect(sent[0]!.headers).not.toHaveProperty('x-correlation-id')
  })

  it('re-mints once on a 401, then reports auth failure', async () => {
    const sent = stubTunnel({
      version: versionWith(['pegii.cloud-auth.v1']),
      data: [
        { status: 401, body: {} },
        { status: 401, body: {} },
      ],
    })
    const client = createPegiiApiClient({ tenantId: 't', baseUrl: BASE, caller: caller() })

    await expect(client.get('/x')).rejects.toMatchObject({ code: 'PEGII_API_AUTH_FAILED' })

    const [first, second] = dataCalls(sent)
    expect(bearer(first!)).not.toBe(bearer(second!))
  })

  it('refuses to call with a cloud token when no principal resolved (503, never subject-less)', async () => {
    const sent = stubTunnel({ version: versionWith(['pegii.cloud-auth.v1']), data: [] })
    const client = createPegiiApiClient({
      tenantId: 't',
      baseUrl: BASE,
      caller: caller({ principal: { tenantUserId: null, isServiceAccount: false } }),
    })

    const err = await client.get('/x').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PegiiApiError)
    expect(pegiiApiErrorToHttp(err as PegiiApiError)).toMatchObject({
      status: 503,
      code: 'PEGII_PRINCIPAL_UNRESOLVED',
    })
    expect(dataCalls(sent)).toHaveLength(0)
  })

  it('carries cid for a non-default company database', async () => {
    const sent = stubTunnel({ version: versionWith(['pegii.cloud-auth.v1']), data: [] })
    const client = createPegiiApiClient({
      tenantId: 't',
      baseUrl: BASE,
      caller: caller({
        principal: { tenantUserId: 'user-1', isServiceAccount: false },
        company: { id: 'co-2', code: 'QMM-CA', dataSourceKey: 'QMM_CA', systemEmployeeCode: 1001 },
      }),
    })

    await client.get('/x')

    const claims = decodeJwt(bearer(dataCalls(sent)[0]!)!)
    expect(claims).toMatchObject({ cid: 'QMM_CA', ptype: 'user' })
    expect(claims).not.toHaveProperty('emp')
  })
})

describe('x-correlation-id', () => {
  it('is forwarded on /version, data calls and /health', async () => {
    const sent = stubTunnel({ version: versionWith([]), data: [] })
    const client = createPegiiApiClient({ tenantId: 't', baseUrl: BASE, caller: caller() })

    await client.get('/x')
    // /health is answered from the same stub (non-version URL).
    await client.getHealth().catch(() => undefined)

    expect(sent.length).toBeGreaterThanOrEqual(3)
    for (const s of sent) expect(s.headers['x-correlation-id']).toBe('cloud-req-123')
  })
})
