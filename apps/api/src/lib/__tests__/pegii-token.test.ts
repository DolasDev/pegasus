import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLocalJWKSet, decodeProtectedHeader, exportJWK, jwtVerify } from 'jose'
import {
  buildPegiiTokenClaims,
  createPegiiTokenMinter,
  pegiiSiteAudience,
  pegiiTokenExpiresAt,
  PEGII_TOKEN_TTL_SECONDS,
  type MintPegiiTokenInput,
} from '../pegii-token'
import { createLocalSigner } from '../pegii-signer'
import { type PegiiApiError } from '../pegii-api-error'

const ISSUER = 'https://api.pegasus.example.test'
const SITE = 'site-1'

function input(overrides: Partial<MintPegiiTokenInput> = {}): MintPegiiTokenInput {
  return {
    tenantId: 'tenant-1',
    siteId: SITE,
    company: { dataSourceKey: 'QMM_CA', systemEmployeeCode: 1001 },
    principal: { tenantUserId: 'user-1', isServiceAccount: false },
    ...overrides,
  }
}

async function localKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const signer = createLocalSigner({ keyId: 'kid-1', privateKey })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' }
  return { signer, jwks: createLocalJWKSet({ keys: [jwk] }) }
}

describe('buildPegiiTokenClaims', () => {
  it('builds the contract claim set for a user', () => {
    const c = buildPegiiTokenClaims(input(), ISSUER, 1000, 'jti-1')
    expect(c).toEqual({
      iss: ISSUER,
      aud: 'pegii-site:site-1',
      sub: 'user-1',
      tid: 'tenant-1',
      ptype: 'user',
      iat: 1000,
      nbf: 1000,
      exp: 1000 + PEGII_TOKEN_TTL_SECONDS,
      jti: 'jti-1',
      cid: 'QMM_CA',
    })
    expect(PEGII_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(300)
  })

  it('omits cid for the default company (null dataSourceKey)', () => {
    const c = buildPegiiTokenClaims(
      input({ company: { dataSourceKey: null, systemEmployeeCode: null } }),
      ISSUER,
      1,
      'j',
    )
    expect(c).not.toHaveProperty('cid')
  })

  it('stamps emp from the company system employee for service accounts only', () => {
    const service = buildPegiiTokenClaims(
      input({ principal: { tenantUserId: 'svc-1', isServiceAccount: true } }),
      ISSUER,
      1,
      'j',
    )
    expect(service.ptype).toBe('service')
    expect(service.emp).toBe(1001)
    expect(buildPegiiTokenClaims(input(), ISSUER, 1, 'j')).not.toHaveProperty('emp')
  })

  it("stamps a user's membership as emp + wun (I3)", () => {
    const c = buildPegiiTokenClaims(
      input({
        principal: {
          tenantUserId: 'user-1',
          isServiceAccount: false,
          attribution: { employeeCode: 4471, windowsUsername: 'jdoe' },
        },
      }),
      ISSUER,
      1,
      'j',
    )
    expect(c).toMatchObject({ ptype: 'user', emp: 4471, wun: 'jdoe' })
  })

  it('omits wun when the linked employee has no Windows username', () => {
    const c = buildPegiiTokenClaims(
      input({
        principal: {
          tenantUserId: 'user-1',
          isServiceAccount: false,
          attribution: { employeeCode: 4471, windowsUsername: null },
        },
      }),
      ISSUER,
      1,
      'j',
    )
    expect(c.emp).toBe(4471)
    expect(c).not.toHaveProperty('wun')
  })

  it("a service account keeps the company's system employee even if attribution is passed", () => {
    const c = buildPegiiTokenClaims(
      input({
        principal: {
          tenantUserId: 'svc-1',
          isServiceAccount: true,
          attribution: { employeeCode: 4471, windowsUsername: 'jdoe' },
        },
      }),
      ISSUER,
      1,
      'j',
    )
    expect(c.emp).toBe(1001)
    expect(c).not.toHaveProperty('wun')
  })

  // Cloud identity I4: only POST /desktop/session mints `scp`, after its
  // membership check; pegII's desktop connection route requires it.
  it('stamps scp=desktop only when a scope is requested', () => {
    expect(buildPegiiTokenClaims(input(), ISSUER, 1, 'j')).not.toHaveProperty('scp')
    expect(buildPegiiTokenClaims(input({ scope: 'desktop' }), ISSUER, 1, 'j').scp).toBe('desktop')
  })

  it('refuses a scoped token for a service account', () => {
    expect(() =>
      buildPegiiTokenClaims(
        input({ scope: 'desktop', principal: { tenantUserId: 'svc-1', isServiceAccount: true } }),
        ISSUER,
        1,
        'j',
      ),
    ).toThrow(expect.objectContaining({ code: 'PEGII_PRINCIPAL_UNRESOLVED' }) as PegiiApiError)
  })

  it.each([null, undefined, ''])('refuses to mint without a subject (%s)', (sub) => {
    expect(() =>
      buildPegiiTokenClaims(
        input({ principal: { tenantUserId: sub, isServiceAccount: false } }),
        ISSUER,
        1,
        'j',
      ),
    ).toThrow(expect.objectContaining({ code: 'PEGII_PRINCIPAL_UNRESOLVED' }) as PegiiApiError)
  })
})

describe('createPegiiTokenMinter', () => {
  it('mints an ES256 JWT that verifies against the JWKS with the contract header', async () => {
    const { signer, jwks } = await localKeys()
    const minter = createPegiiTokenMinter({ signer, issuer: ISSUER })

    const token = await minter.mint(input())

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'kid-1' })
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience: pegiiSiteAudience(SITE),
      algorithms: ['ES256'],
    })
    expect(payload.sub).toBe('user-1')
    expect(payload['cid']).toBe('QMM_CA')
  })

  it('caches per (tenant, principal, site, company, attribution) until shortly before exp', async () => {
    const { signer } = await localKeys()
    let now = 1_000_000_000_000
    const minter = createPegiiTokenMinter({ signer, issuer: ISSUER, now: () => now })

    const first = await minter.mint(input())
    expect(await minter.mint(input())).toBe(first)
    expect(await minter.mint(input({ siteId: 'site-2' }))).not.toBe(first)
    expect(
      await minter.mint(input({ company: { dataSourceKey: 'QMM_US', systemEmployeeCode: null } })),
    ).not.toBe(first)

    const linked = input({
      principal: {
        tenantUserId: 'user-1',
        isServiceAccount: false,
        attribution: { employeeCode: 4471, windowsUsername: 'jdoe' },
      },
    })
    expect(await minter.mint(linked)).not.toBe(first)

    now += (PEGII_TOKEN_TTL_SECONDS - 61) * 1000
    expect(await minter.mint(input())).toBe(first)
    now += 2000
    expect(await minter.mint(input())).not.toBe(first)
  })

  it('never serves a desktop-scoped token from the bridge cache slot (or vice versa)', async () => {
    const { signer, jwks } = await localKeys()
    const minter = createPegiiTokenMinter({ signer, issuer: ISSUER })

    const bridge = await minter.mint(input())
    const desktop = await minter.mint(input({ scope: 'desktop' }))

    expect(desktop).not.toBe(bridge)
    expect(await minter.mint(input())).toBe(bridge)
    const verify = (t: string) =>
      jwtVerify(t, jwks, { issuer: ISSUER, audience: pegiiSiteAudience(SITE) })
    expect((await verify(bridge)).payload).not.toHaveProperty('scp')
    expect((await verify(desktop)).payload['scp']).toBe('desktop')
  })

  it('pegiiTokenExpiresAt reads exp from a minted token', async () => {
    const { signer } = await localKeys()
    const now = 1_000_000_000_000
    const minter = createPegiiTokenMinter({ signer, issuer: ISSUER, now: () => now })

    const token = await minter.mint(input())

    expect(pegiiTokenExpiresAt(token)).toBe(now / 1000 + PEGII_TOKEN_TTL_SECONDS)
  })

  it('re-mints after invalidate', async () => {
    const { signer } = await localKeys()
    const minter = createPegiiTokenMinter({ signer, issuer: ISSUER })
    const first = await minter.mint(input())

    minter.invalidate(input())

    expect(await minter.mint(input())).not.toBe(first)
  })
})

// The shared I1 ↔ I2 fixture: pegII (movemanager) verifies these exact bytes too.
describe('shared token fixture', () => {
  const dir = join(__dirname, '..', '..', '__fixtures__', 'pegii-token')
  const jwks = JSON.parse(readFileSync(join(dir, 'jwks.json'), 'utf8')) as {
    keys: Record<string, unknown>[]
  }
  const fixture = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8')) as {
    now: number
    maxClockSkewSeconds: number
    issuer: string
    audience: string
    expect: Record<string, string>
    tokenSegments: Record<string, [string, string, string]>
  }
  /** Tokens are stored as JWS segments (no dot-joined JWT literal in the repo). */
  const token = (name: string) => fixture.tokenSegments[name]!.join('.')
  const keySet = createLocalJWKSet({ keys: jwks.keys })
  const verifyAtFixtureNow = (token: string) =>
    jwtVerify(token, keySet, {
      issuer: fixture.issuer,
      audience: fixture.audience,
      algorithms: ['ES256'],
      currentDate: new Date(fixture.now * 1000),
      clockTolerance: fixture.maxClockSkewSeconds,
    })

  it('publishes only public key material', () => {
    for (const k of jwks.keys) {
      expect(k).not.toHaveProperty('d')
      expect(() => createPublicKey({ key: k as never, format: 'jwk' })).not.toThrow()
    }
  })

  it.each(Object.entries(fixture.expect))('%s → %s', async (name, verdict) => {
    const sample = token(name)
    if (verdict.startsWith('accept')) {
      await expect(verifyAtFixtureNow(sample)).resolves.toBeDefined()
    } else {
      await expect(verifyAtFixtureNow(sample)).rejects.toThrow()
    }
  })

  it('carries the contract claims on the accepted samples', async () => {
    const service = (await verifyAtFixtureNow(token('service'))).payload
    expect(service).toMatchObject({ ptype: 'service', emp: 1001, cid: 'QMM_CA' })
    const noCid = (await verifyAtFixtureNow(token('noCid'))).payload
    expect(noCid).not.toHaveProperty('cid')
    expect(noCid.exp! - noCid.iat!).toBeLessThanOrEqual(300)
  })
})

// The I4 desktop-session fixture (its own key; the I1 fixture is never
// regenerated). Every sample is a valid cloud token; the desktop connection
// route tells them apart by ptype + scp. movemanager verifies the same bytes.
describe('shared desktop-session token fixture', () => {
  const dir = join(__dirname, '..', '..', '__fixtures__', 'pegii-token-desktop')
  const jwks = JSON.parse(readFileSync(join(dir, 'jwks.json'), 'utf8')) as {
    keys: Record<string, unknown>[]
  }
  const fixture = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8')) as {
    now: number
    maxClockSkewSeconds: number
    issuer: string
    audience: string
    expectDesktopConnection: Record<string, string>
    tokenSegments: Record<string, [string, string, string]>
  }
  const keySet = createLocalJWKSet({ keys: jwks.keys })
  const verify = (name: string) =>
    jwtVerify(fixture.tokenSegments[name]!.join('.'), keySet, {
      issuer: fixture.issuer,
      audience: fixture.audience,
      algorithms: ['ES256'],
      currentDate: new Date(fixture.now * 1000),
      clockTolerance: fixture.maxClockSkewSeconds,
    })

  it('publishes only public key material', () => {
    for (const k of jwks.keys) expect(k).not.toHaveProperty('d')
  })

  it.each(Object.entries(fixture.expectDesktopConnection))('%s → %s', async (name, verdict) => {
    // Valid as a cloud token in every case…
    const { payload } = await verify(name)
    // …and the desktop policy is exactly ptype=user AND scp=desktop.
    const desktopPolicy = payload['ptype'] === 'user' && payload['scp'] === 'desktop'
    expect(desktopPolicy).toBe(verdict.startsWith('serve'))
  })

  it('carries cid/emp/wun on the linked sample and none on the bootstrap sample', async () => {
    expect((await verify('desktop')).payload).toMatchObject({
      cid: 'QMM_US',
      emp: 7429,
      wun: 'jdoe',
    })
    expect((await verify('desktopNoCid')).payload).not.toHaveProperty('cid')
    const unlinked = (await verify('desktopUnlinked')).payload
    expect(unlinked).not.toHaveProperty('emp')
    expect(unlinked).not.toHaveProperty('wun')
  })
})
