// ---------------------------------------------------------------------------
// Opaque bearer/capability tokens — mint, hash, timing-safe compare.
//
// The one place the repo mints an opaque secret whose SHA-256 hash (not the
// plaintext) is persisted, indexed by a short prefix, and later verified with a
// constant-time compare. Two callers share it:
//   - IngressCredential (`ing_`) — the bearer a partner POSTs to the ingress.
//   - FeedbackRequest   (`fbk_`) — the capability link a respondent opens.
//
// Shape (matches ApiClient keys): `<prefix>_<48 hex>`. The 12-char token prefix
// (`<prefix>_` + 8 hex) indexes the DB lookup; the full hash is then compared
// timing-safe so a prefix collision never leaks whether the remainder matched.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import { timingSafeEqual } from 'node:crypto'

/** A freshly minted token: the plaintext (shown once), its prefix, and its hash. */
export interface MintedToken {
  /** The plaintext `<prefix>_<48 hex>` — returned once, never stored. */
  plainToken: string
  /** First 12 chars (`<prefix>_` + 8 hex) — the indexed lookup key. */
  tokenPrefix: string
  /** SHA-256 hex of the plaintext — the only form persisted. */
  tokenHash: string
}

/** SHA-256 hex of a token plaintext. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Mint an opaque token with the given short namespace prefix (e.g. `ing`, `fbk`).
 * 24 random bytes → 48 hex chars of entropy.
 */
export function generateOpaqueToken(prefix: string): MintedToken {
  const hex = crypto.randomBytes(24).toString('hex') // 48 hex chars
  const plainToken = `${prefix}_${hex}`
  const tokenPrefix = plainToken.slice(0, 12) // "<prefix>_" + leading hex
  return { plainToken, tokenPrefix, tokenHash: hashToken(plainToken) }
}

/** The 12-char lookup prefix for a presented token (mirrors generateOpaqueToken). */
export function tokenPrefixOf(token: string): string {
  return token.slice(0, 12)
}

/** Constant-time compare of a presented token against a stored SHA-256 hash. */
export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token))
  const expected = Buffer.from(expectedHash)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
