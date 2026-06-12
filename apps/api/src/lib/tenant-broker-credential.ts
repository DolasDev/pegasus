// ---------------------------------------------------------------------------
// Per-tenant workflow-broker credentials (Phase 3 Unit 7).
//
// The sandbox security keystone: a tenant-runner container must never hold
// the global WORKFLOW_BROKER_SECRET, because tenant code imported by the
// runner could read it from the environment and mint ANY tenant's runtime
// token (the broker endpoint only needs an executionId). Instead each tenant
// gets exactly one opaque token; the broker accepts it but enforces
// `execution.tenantId === credential.tenantId` on every request.
//
// Token format
// ────────────
//   wbk_<tenantId>_<48 hex chars>
//
// The `wbk_` prefix is distinct from `vnd_` runtime tokens and from the
// shared broker secret (an unprefixed random string), so a leaked value is
// attributable at a glance. The tenantId is embedded so verification is a
// single unique-index lookup — never a scan across all tenants' hashes. The
// embedded id carries no authority by itself: the presented token's SHA-256
// must match that tenant's stored hash (timing-safe compare).
//
// At-rest forms (two columns, deliberately)
// ─────────────────────────────────────────
//   * tokenHash       — SHA-256 hex of the FULL token. The broker verifies
//                       against this and never needs the plaintext back.
//   * tokenCiphertext — KMS-encrypted plaintext (same key as
//                       Workflow.runtimeTokenCiphertext, via the
//                       runtime-token-crypto helpers). Exists ONLY so the
//                       Unit 9 runner dispatcher can recover the plaintext at
//                       ECS task-launch time and inject it into the runner's
//                       env. The plaintext is never logged and never returned
//                       by any HTTP endpoint.
//
// Rotation revokes: there is at most one credential row per tenant (unique
// tenantId), so rotating replaces the stored hash and the old plaintext stops
// verifying immediately.
//
// No HTTP surface — provisioning is internal (the Unit 9 dispatcher calls
// getOrCreateTenantBrokerCredential at task launch).
// ---------------------------------------------------------------------------

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { encryptRuntimeToken, decryptRuntimeToken } from './runtime-token-crypto'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Token format
// ---------------------------------------------------------------------------

export const TENANT_BROKER_TOKEN_PREFIX = 'wbk_'

/** Strict shape: wbk_<uuid>_<48 lowercase hex>. Anything else parses to null. */
const TOKEN_REGEX =
  /^wbk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f]{48})$/

/**
 * Extracts the embedded tenantId from a presented token, or null when the
 * token does not match the `wbk_<uuid>_<48 hex>` shape. Parsing grants no
 * authority — callers must still verify the token against the stored hash.
 */
export function parseTenantBrokerToken(token: string): { tenantId: string } | null {
  const m = TOKEN_REGEX.exec(token)
  if (!m) return null
  return { tenantId: m[1]! }
}

/** SHA-256 hex of the full token — the broker's at-rest comparison form. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Mints a fresh token for `tenantId`. 24 random bytes → 48 hex chars. */
function mintToken(tenantId: string): { plaintext: string; tokenHash: string } {
  const plaintext = `${TENANT_BROKER_TOKEN_PREFIX}${tenantId}_${randomBytes(24).toString('hex')}`
  // Fail loudly if the id can't round-trip through TOKEN_REGEX (e.g. a
  // non-lowercase-UUID tenant id) — otherwise we'd persist a credential whose
  // token silently never verifies.
  if (!parseTenantBrokerToken(plaintext)) {
    throw new Error(`cannot mint broker token: tenantId is not a lowercase UUID`)
  }
  return { plaintext, tokenHash: hashToken(plaintext) }
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Returns the tenant's broker-token plaintext, minting + persisting the
 * credential on first use. Idempotent: subsequent calls return the SAME
 * token (KMS-decrypted from the stored ciphertext) — they do not re-mint.
 *
 * Called by the Unit 9 runner dispatcher at ECS task-launch time; the
 * plaintext goes straight into the launched task's env and is never logged.
 *
 * Concurrency-safe: a create race against the unique tenantId loses with
 * P2002 and falls back to reading the winner's row.
 */
export async function getOrCreateTenantBrokerCredential(
  db: PrismaClient,
  tenantId: string,
): Promise<string> {
  const existing = await db.tenantBrokerCredential.findUnique({
    where: { tenantId },
    select: { tokenCiphertext: true },
  })
  if (existing) {
    return decryptRuntimeToken(existing.tokenCiphertext)
  }

  const { plaintext, tokenHash } = mintToken(tenantId)
  const tokenCiphertext = await encryptRuntimeToken(plaintext)
  try {
    await db.tenantBrokerCredential.create({
      data: { tenantId, tokenHash, tokenCiphertext },
    })
  } catch (err) {
    // Unique-violation on tenantId: a concurrent caller minted first. Their
    // credential is the credential — discard ours and return theirs.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await db.tenantBrokerCredential.findUnique({
        where: { tenantId },
        select: { tokenCiphertext: true },
      })
      if (winner) return decryptRuntimeToken(winner.tokenCiphertext)
    }
    throw err
  }

  logger.info('tenant_broker_credential.minted', { tenantId })
  return plaintext
}

/**
 * Replaces the tenant's broker credential with a freshly minted one and
 * returns the new plaintext. The previous token stops verifying immediately
 * (the stored hash is overwritten). Internal/ops use only — no HTTP surface.
 */
export async function rotateTenantBrokerCredential(
  db: PrismaClient,
  tenantId: string,
): Promise<string> {
  const { plaintext, tokenHash } = mintToken(tenantId)
  const tokenCiphertext = await encryptRuntimeToken(plaintext)
  await db.tenantBrokerCredential.upsert({
    where: { tenantId },
    create: { tenantId, tokenHash, tokenCiphertext, rotatedAt: new Date() },
    update: { tokenHash, tokenCiphertext, rotatedAt: new Date() },
  })
  logger.info('tenant_broker_credential.rotated', { tenantId })
  return plaintext
}

// ---------------------------------------------------------------------------
// Verification (broker auth path)
// ---------------------------------------------------------------------------

/**
 * Verifies a presented `wbk_` token and returns the tenantId it is scoped to,
 * or null for anything invalid (malformed shape, unknown tenant, hash
 * mismatch — e.g. a token from before a rotation). Callers map null to 401.
 *
 * The comparison is hash-vs-hash with `crypto.timingSafeEqual`: both sides
 * are SHA-256 hex digests (fixed 64 bytes), so lengths always match and the
 * compare runs in constant time regardless of where the difference is.
 */
export async function verifyTenantBrokerToken(
  db: PrismaClient,
  presented: string,
): Promise<{ tenantId: string } | null> {
  const parsed = parseTenantBrokerToken(presented)
  if (!parsed) return null

  const row = await db.tenantBrokerCredential.findUnique({
    where: { tenantId: parsed.tenantId },
    select: { tokenHash: true },
  })
  if (!row) return null

  const presentedHash = Buffer.from(hashToken(presented), 'utf8')
  const storedHash = Buffer.from(row.tokenHash, 'utf8')
  if (presentedHash.length !== storedHash.length) return null
  if (!timingSafeEqual(presentedHash, storedHash)) return null

  return { tenantId: parsed.tenantId }
}
