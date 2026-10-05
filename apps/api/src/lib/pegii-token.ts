// ---------------------------------------------------------------------------
// Cloud-issued pegII tokens — the cloud is the identity provider for the
// on-prem pegII API (plans/todo/cloud-identity-and-companies.md, D-I1/D-I2).
//
// Every bridge call carries a short-lived ES256 JWT minted here on behalf of
// the request's principal. pegII validates it against GET /.well-known/jwks.json
// and checks only signature/iss/aud/exp — WHICH principal may do what was
// already decided by Cedar before the bridge call (the cloud is the gate).
// `emp`/`wun` are for attribution only, never for access.
//
// The claim set is the "Token contract (I1 ↔ I2)" in the design doc; the shared
// fixture under src/__fixtures__/pegii-token/ pins it for both repos.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { PegiiApiError } from './pegii-api-error'
import { createKmsSigner, type Signer } from './pegii-signer'
import type { PegiiTokenProvider } from './pegii-auth'

/** Token lifetime. The contract caps `exp` at `iat + 300`. */
export const PEGII_TOKEN_TTL_SECONDS = 300
/** Re-mint this long before `exp` so an in-flight call never carries a dying token. */
const RENEW_MARGIN_SECONDS = 60

/** `aud` for a site — a token minted for one site is useless at another. */
export function pegiiSiteAudience(siteId: string): string {
  return `pegii-site:${siteId}`
}

export interface PegiiTokenPrincipal {
  /** TenantUser.id — the human user, or the service account an ApiClient acts as. */
  tenantUserId: string | null | undefined
  isServiceAccount: boolean
  /**
   * A human user's LINKED CompanyMembership in the target company (cloud
   * identity I3) → `emp`/`wun`. Ignored for service accounts, which take the
   * company's systemEmployeeCode instead.
   */
  attribution?: { employeeCode: number; windowsUsername: string | null } | null
}

export interface PegiiTokenCompany {
  /** null ⇒ the site's default DB ⇒ no `cid` claim. */
  dataSourceKey: string | null
  /** `emp` for service-account tokens (e.g. NW's 1001 "PEGASUS GENERATED"). */
  systemEmployeeCode: number | null
}

export interface MintPegiiTokenInput {
  tenantId: string
  siteId: string
  company: PegiiTokenCompany
  principal: PegiiTokenPrincipal
}

export interface PegiiTokenClaims {
  iss: string
  aud: string
  sub: string
  tid: string
  ptype: 'user' | 'service'
  iat: number
  nbf: number
  exp: number
  jti: string
  cid?: string
  emp?: number
  wun?: string
}

export interface PegiiTokenMinter {
  mint(input: MintPegiiTokenInput): Promise<string>
  /** Drop a cached token (after pegII rejected it with 401). */
  invalidate(input: MintPegiiTokenInput): void
}

function b64url(bytes: Uint8Array | string): string {
  return Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).toString(
    'base64url',
  )
}

/** The claim set for a mint, per the contract. Pure — exported for tests. */
export function buildPegiiTokenClaims(
  input: MintPegiiTokenInput,
  issuer: string,
  nowSeconds: number,
  jti: string,
): PegiiTokenClaims {
  const sub = input.principal.tenantUserId
  if (!sub) {
    // Never mint a subject-less token: an ApiClient with no acts-as user (legacy
    // row) or a Cognito request whose TenantUser didn't resolve is refused.
    throw new PegiiApiError(
      'PEGII_PRINCIPAL_UNRESOLVED',
      'the request has no resolved TenantUser to act as for the pegII call',
    )
  }
  const service = input.principal.isServiceAccount
  const claims: PegiiTokenClaims = {
    iss: issuer,
    aud: pegiiSiteAudience(input.siteId),
    sub,
    tid: input.tenantId,
    ptype: service ? 'service' : 'user',
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + PEGII_TOKEN_TTL_SECONDS,
    jti,
  }
  if (input.company.dataSourceKey) claims.cid = input.company.dataSourceKey
  if (service && input.company.systemEmployeeCode != null) {
    claims.emp = input.company.systemEmployeeCode
  }
  const attribution = input.principal.attribution
  if (!service && attribution) {
    claims.emp = attribution.employeeCode
    if (attribution.windowsUsername) claims.wun = attribution.windowsUsername
  }
  return claims
}

/** Sign a claim set as a compact ES256 JWS. */
export async function signPegiiToken(claims: PegiiTokenClaims, signer: Signer): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT', kid: signer.keyId }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  const signature = await signer.sign(new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(signature)}`
}

export function createPegiiTokenMinter(opts: {
  signer: Signer
  issuer: string
  now?: () => number
}): PegiiTokenMinter {
  const now = opts.now ?? Date.now
  const cache = new Map<string, { token: string; renewAt: number }>()
  // Attribution is in the key, so a membership change (a sync) re-mints at once
  // instead of riding a cached token with the old `emp`/`wun`.
  const keyOf = (i: MintPegiiTokenInput) =>
    [
      i.tenantId,
      i.principal.tenantUserId ?? '',
      i.siteId,
      i.company.dataSourceKey ?? '',
      i.principal.attribution?.employeeCode ?? '',
      i.principal.attribution?.windowsUsername ?? '',
    ].join('|')

  return {
    async mint(input) {
      const key = keyOf(input)
      const nowMs = now()
      const hit = cache.get(key)
      if (hit && nowMs < hit.renewAt) return hit.token

      const iat = Math.floor(nowMs / 1000)
      const claims = buildPegiiTokenClaims(input, opts.issuer, iat, randomUUID())
      const token = await signPegiiToken(claims, opts.signer)
      cache.set(key, { token, renewAt: (claims.exp - RENEW_MARGIN_SECONDS) * 1000 })
      return token
    },
    invalidate(input) {
      cache.delete(keyOf(input))
    },
  }
}

/** Configured signing key ids (first = current signer), from PEGII_TOKEN_KMS_KEY_IDS. */
export function pegiiTokenKeyIds(): string[] {
  return (process.env['PEGII_TOKEN_KMS_KEY_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

let defaultMinter: PegiiTokenMinter | null = null

/**
 * The process-wide KMS-backed minter. Throws PEGII_TOKEN_NOT_CONFIGURED when the
 * environment lacks the key ids or issuer (both are wired in CDK) — never a
 * silent fallback to an unsigned or locally-signed token.
 */
export function getPegiiTokenMinter(): PegiiTokenMinter {
  if (defaultMinter) return defaultMinter
  const [keyId] = pegiiTokenKeyIds()
  const issuer = process.env['PEGII_TOKEN_ISSUER']
  if (!keyId || !issuer) {
    throw new PegiiApiError(
      'PEGII_TOKEN_NOT_CONFIGURED',
      'PEGII_TOKEN_KMS_KEY_IDS and PEGII_TOKEN_ISSUER must be set to mint pegII tokens',
    )
  }
  defaultMinter = createPegiiTokenMinter({ signer: createKmsSigner({ keyId }), issuer })
  return defaultMinter
}

/** Test seam. */
export function __setPegiiTokenMinterForTests(minter: PegiiTokenMinter | null): void {
  defaultMinter = minter
}

/**
 * Adapt the minter to the pegII client's auth seam: every call gets a cloud
 * token for this (principal, site, company); a 401 invalidates and re-mints.
 */
export function createCloudTokenProvider(
  input: MintPegiiTokenInput,
  minter: () => PegiiTokenMinter = getPegiiTokenMinter,
): PegiiTokenProvider {
  return {
    getToken: () => minter().mint(input),
    invalidate: () => minter().invalidate(input),
  }
}
