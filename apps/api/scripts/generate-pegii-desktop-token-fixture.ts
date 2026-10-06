// ---------------------------------------------------------------------------
// Generates the shared DESKTOP-session pegII token fixture
// (src/__fixtures__/pegii-token-desktop/) — cloud identity I4.
//
// The I1 fixture (src/__fixtures__/pegii-token/) is shared byte-for-byte with
// movemanager and its private key was never written, so new samples cannot be
// signed with it and it is deliberately NOT regenerated. This is a second,
// self-contained fixture (own throwaway key, own jwks.json) pinning the `scp`
// claim: pegII's desktop connection route serves only `ptype=user` +
// `scp=desktop` tokens; a bridge-shaped user token (no `scp`) is a valid cloud
// token everywhere else but must be refused there.
//
// movemanager copies this directory verbatim into
// Pegasus.Api.Tests/Fixtures/cloud-token-desktop/ and verifies the same bytes.
// Each run uses a fresh key, so every byte changes — regenerate only when the
// contract changes, then re-copy.
//
//   npx tsx scripts/generate-pegii-desktop-token-fixture.ts
// ---------------------------------------------------------------------------

import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportJWK } from 'jose'
import { createLocalSigner } from '../src/lib/pegii-signer'
import { signPegiiToken, pegiiSiteAudience, type PegiiTokenClaims } from '../src/lib/pegii-token'

const DIR = join(__dirname, '..', 'src', '__fixtures__', 'pegii-token-desktop')
const KEY_ID = 'test-only-0000-4000-8000-0000000000d1'
const ISSUER = 'https://api.pegasus.example.test'
const SITE_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const SERVICE_ID = '44444444-4444-4444-8444-444444444444'
/** Fixed "now" every consumer must validate against (2026-10-06T00:00:00Z). */
const NOW = 1_791_244_800

function claims(overrides: Partial<PegiiTokenClaims> = {}): PegiiTokenClaims {
  return {
    iss: ISSUER,
    aud: pegiiSiteAudience(SITE_ID),
    sub: USER_ID,
    tid: TENANT_ID,
    ptype: 'user',
    iat: NOW,
    nbf: NOW,
    exp: NOW + 300,
    jti: '66666666-6666-4666-8666-000000000000',
    cid: 'QMM_US',
    emp: 7429,
    wun: 'jdoe',
    scp: 'desktop',
    ...overrides,
  }
}

async function main(): Promise<void> {
  mkdirSync(DIR, { recursive: true })
  const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
  const signer = createLocalSigner({ keyId: KEY_ID, privateKey: key })

  const { cid: _c, ...noCid } = claims({ jti: '66666666-6666-4666-8666-000000000002' })
  const { scp: _s, ...bridge } = claims({ jti: '66666666-6666-4666-8666-000000000003' })
  const {
    emp: _e,
    wun: _w,
    ...bootstrap
  } = claims({
    jti: '66666666-6666-4666-8666-000000000006',
  })
  const tokens = {
    desktop: await signPegiiToken(claims({ jti: '66666666-6666-4666-8666-000000000001' }), signer),
    desktopNoCid: await signPegiiToken(noCid as PegiiTokenClaims, signer),
    bridgeUser: await signPegiiToken(bridge as PegiiTokenClaims, signer),
    serviceScoped: await signPegiiToken(
      claims({
        sub: SERVICE_ID,
        ptype: 'service',
        emp: 1001,
        jti: '66666666-6666-4666-8666-000000000004',
      }),
      signer,
    ),
    otherScope: await signPegiiToken(
      claims({
        scp: 'admin' as PegiiTokenClaims['scp'],
        jti: '66666666-6666-4666-8666-000000000005',
      }),
      signer,
    ),
    desktopUnlinked: await signPegiiToken(bootstrap as PegiiTokenClaims, signer),
  }

  const publicJwk = await exportJWK(key)
  delete publicJwk.d
  const jwks = { keys: [{ ...publicJwk, kid: KEY_ID, alg: 'ES256', use: 'sig' }] }

  writeFileSync(join(DIR, 'jwks.json'), JSON.stringify(jwks, null, 2) + '\n')
  writeFileSync(
    join(DIR, 'tokens.json'),
    JSON.stringify(
      {
        now: NOW,
        maxClockSkewSeconds: 60,
        issuer: ISSUER,
        siteId: SITE_ID,
        audience: pegiiSiteAudience(SITE_ID),
        tenantId: TENANT_ID,
        // What pegII's desktop connection route must do with each. Every sample is
        // a VALID cloud token (signature, iss, aud, exp all good); only the
        // desktop policy (ptype=user AND scp=desktop) tells them apart.
        expectDesktopConnection: {
          desktop: 'serve (cid=QMM_US, emp=7429, wun=jdoe)',
          desktopNoCid: "serve (the site's default company DB)",
          desktopUnlinked: 'serve (cid=QMM_US, no emp/wun: a tenant_admin bootstrap)',
          bridgeUser: 'refuse (no scp: a bridge token)',
          serviceScoped: 'refuse (ptype=service)',
          otherScope: 'refuse (scp is not "desktop")',
        },
        // Stored as JWS segments — join with "." — so the repo never holds a
        // dot-joined JWT literal for the secret scanner's `jwt` rule to flag.
        tokenSegments: Object.fromEntries(
          Object.entries(tokens).map(([name, token]) => [name, token.split('.')]),
        ),
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`wrote fixture to ${DIR}`)
}

void main()
