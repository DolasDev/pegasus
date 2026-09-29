import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { type LambdaClient } from '@aws-sdk/client-lambda'
import { setTunnelLambdaClient } from '../tunnel-client'
import {
  createPegiiTokenProvider,
  isPegiiCredentialSecretRef,
  jwtExpiryMs,
  __resetPegiiAuthCachesForTests,
} from '../pegii-auth'

const ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:pegasus/test/pegii/t1-AbCdEf'

/** A syntactically valid (unsigned) JWT whose only claim that matters is `exp`. */
function jwt(expSeconds: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ sub: 'pegasus-cloud', exp: expSeconds })}.sig`
}

function stubLogins(responses: Array<{ status: number; body: string }>) {
  const send = vi.fn()
  for (const r of responses) {
    send.mockResolvedValueOnce({
      Payload: new TextEncoder().encode(
        JSON.stringify({ status: r.status, headers: {}, body: r.body }),
      ),
    })
  }
  setTunnelLambdaClient({ send } as unknown as LambdaClient)
  return send
}

const loginOk = (token: string) => ({
  status: 200,
  body: JSON.stringify({
    data: { token, mustChangePassword: false, canAccessAllCompanies: false },
  }),
})

let clock = 1_000_000_000_000
const fetchSecret = vi.fn(async () => ({
  username: 'pegasus-cloud',
  password: 'test-only-password',
}))
const provider = () =>
  createPegiiTokenProvider({
    tenantId: 't1',
    baseUrl: 'http://10.200.7.1:65274',
    secretArn: ARN,
    fetchSecret,
    now: () => clock,
  })

beforeEach(() => {
  process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-proxy-fn'
  __resetPegiiAuthCachesForTests()
  fetchSecret.mockClear()
  clock = 1_000_000_000_000
})

afterEach(() => {
  setTunnelLambdaClient(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
})

describe('isPegiiCredentialSecretRef / jwtExpiryMs', () => {
  it('recognises only Secrets Manager ARNs', () => {
    expect(isPegiiCredentialSecretRef(ARN)).toBe(true)
    expect(isPegiiCredentialSecretRef('raw-key')).toBe(false)
    expect(isPegiiCredentialSecretRef(null)).toBe(false)
  })

  it('reads exp from a JWT, null for garbage', () => {
    expect(jwtExpiryMs(jwt(2_000_000_000))).toBe(2_000_000_000_000)
    expect(jwtExpiryMs('not-a-jwt')).toBeNull()
  })
})

describe('createPegiiTokenProvider', () => {
  it('logs in with the secret’s credentials and caches the token until near expiry', async () => {
    const token = jwt(clock / 1000 + 8 * 3600)
    const send = stubLogins([loginOk(token)])
    const p = provider()
    expect(await p.getToken()).toBe(token)
    expect(await p.getToken()).toBe(token)
    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(
      new TextDecoder().decode(
        (send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }).input.Payload,
      ),
    ) as { url: string; method: string; body: string }
    expect(payload.url).toBe('http://10.200.7.1:65274/api/v1/pegii/auth/login')
    expect(payload.method).toBe('POST')
    expect(JSON.parse(payload.body)).toEqual({
      username: 'pegasus-cloud',
      password: 'test-only-password',
    })
  })

  it('logs in again once the token is within five minutes of expiry', async () => {
    const first = jwt(clock / 1000 + 600)
    const second = jwt(clock / 1000 + 8 * 3600)
    const send = stubLogins([loginOk(first), loginOk(second)])
    const p = provider()
    await p.getToken()
    clock += 6 * 60 * 1000 // 4 minutes left on `first`
    expect(await p.getToken()).toBe(second)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('invalidate() forces a fresh login', async () => {
    const send = stubLogins([loginOk(jwt(clock / 1000 + 3600)), loginOk(jwt(clock / 1000 + 7200))])
    const p = provider()
    await p.getToken()
    p.invalidate()
    await p.getToken()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('maps a 401 to PEGII_API_AUTH_FAILED and re-reads the secret next time', async () => {
    stubLogins([{ status: 401, body: JSON.stringify({ code: 'AUTH_INVALID_CREDENTIALS' }) }])
    await expect(provider().getToken()).rejects.toMatchObject({ code: 'PEGII_API_AUTH_FAILED' })
    stubLogins([loginOk(jwt(clock / 1000 + 3600))])
    await provider().getToken()
    expect(fetchSecret).toHaveBeenCalledTimes(2)
  })

  it('maps a site without login (503 AUTH_NOT_CONFIGURED or 404) to PEGII_API_AUTH_UNAVAILABLE', async () => {
    stubLogins([{ status: 503, body: JSON.stringify({ code: 'AUTH_NOT_CONFIGURED' }) }])
    await expect(provider().getToken()).rejects.toMatchObject({
      code: 'PEGII_API_AUTH_UNAVAILABLE',
    })
    stubLogins([{ status: 404, body: '' }])
    await expect(provider().getToken()).rejects.toMatchObject({
      code: 'PEGII_API_AUTH_UNAVAILABLE',
    })
  })

  it('rejects a 200 without a token as a bad envelope', async () => {
    stubLogins([{ status: 200, body: JSON.stringify({ data: {} }) }])
    await expect(provider().getToken()).rejects.toMatchObject({ code: 'PEGII_API_BAD_ENVELOPE' })
  })
})

describe('createPegiiTokenProvider — default secret reader and failures', () => {
  it('reads {username,password} from Secrets Manager when no fetchSecret is injected', async () => {
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
    const sendSpy = vi.spyOn(SecretsManagerClient.prototype, 'send').mockResolvedValue({
      SecretString: JSON.stringify({ username: 'svc', password: 'test-only' }),
    } as never)
    const send = stubLogins([loginOk(jwt(clock / 1000 + 3600))])
    const p = createPegiiTokenProvider({
      tenantId: 't9',
      baseUrl: 'http://x',
      secretArn: ARN,
      now: () => clock,
    })
    await p.getToken()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(
      JSON.parse(
        new TextDecoder().decode(
          (send.mock.calls[0]![0] as { input: { Payload: Uint8Array } }).input.Payload,
        ),
      ).body as string,
    ) as Record<string, string>
    expect(body['username']).toBe('svc')
    sendSpy.mockRestore()
  })

  it('refuses a secret missing username/password', async () => {
    const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
    const sendSpy = vi
      .spyOn(SecretsManagerClient.prototype, 'send')
      .mockResolvedValue({ SecretString: JSON.stringify({ username: 'svc' }) } as never)
    const p = createPegiiTokenProvider({
      tenantId: 't10',
      baseUrl: 'http://x',
      secretArn: ARN,
      now: () => clock,
    })
    await expect(p.getToken()).rejects.toMatchObject({ code: 'PEGII_API_AUTH_FAILED' })
    sendSpy.mockRestore()
  })

  it('maps a tunnel failure during login to PEGII_API_TUNNEL_ERROR', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ FunctionError: 'Unhandled', Payload: new TextEncoder().encode('{}') })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)
    await expect(provider().getToken()).rejects.toMatchObject({ code: 'PEGII_API_TUNNEL_ERROR' })
  })

  it('falls back to a short reuse window when the token has no readable exp', async () => {
    const send = stubLogins([loginOk('opaque-token'), loginOk('opaque-token-2')])
    const p = provider()
    expect(await p.getToken()).toBe('opaque-token')
    expect(await p.getToken()).toBe('opaque-token')
    clock += 6 * 60 * 1000
    expect(await p.getToken()).toBe('opaque-token-2')
    expect(send).toHaveBeenCalledTimes(2)
    expect(jwtExpiryMs('a.%%%notbase64json.c')).toBeNull()
  })
})
