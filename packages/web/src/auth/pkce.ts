// ---------------------------------------------------------------------------
// PKCE — Proof Key for Code Exchange (RFC 7636)
//
// Protects the OAuth Authorization Code flow against authorization code
// interception attacks. The browser generates a random `code_verifier`,
// sends its SHA-256 hash (`code_challenge`) in the /authorize request, then
// proves ownership by sending the raw verifier in the /token request. An
// attacker who intercepts the code cannot exchange it without the verifier.
//
// Code verifier: 96 cryptographically random bytes → base64url → ~128 chars
// Code challenge: SHA-256(verifier) → base64url
// State: 32 random bytes → base64url (CSRF protection)
//
// Storage: verifier and state are written to sessionStorage immediately before
// the /authorize redirect and cleared the moment the callback reads them.
// This makes verifiers single-use; a replay of a consumed code/state pair
// is rejected because the verifier is already gone.
// ---------------------------------------------------------------------------

const STATE_KEY = 'pegasus.oauth.state'
const VERIFIER_KEY_PREFIX = 'pegasus.pkce.'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a byte array to base64url.
 * base64url differs from standard base64: '+' → '-', '/' → '_', no '=' padding.
 */
function base64url(bytes: Uint8Array): string {
  // btoa produces standard base64; we patch it to base64url.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generates a cryptographically random PKCE code verifier (RFC 7636 §4.1). */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(96)) // → 128-char base64url
  return base64url(bytes)
}

/**
 * Computes the S256 PKCE code challenge from a verifier (RFC 7636 §4.2).
 * Async because SubtleCrypto.digest is always async in the Web Crypto API.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return base64url(new Uint8Array(digest))
}

/** Generates a random state value for CSRF protection. */
export function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

/**
 * Saves the PKCE verifier and state to sessionStorage before the OAuth redirect.
 * The verifier is keyed by state to support multiple concurrent tabs each
 * starting their own auth flow.
 */
export function savePkceState(state: string, verifier: string): void {
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(`${VERIFIER_KEY_PREFIX}${state}`, verifier)
}

/**
 * Reads and immediately clears the stored PKCE verifier for a given state.
 * Validates that the returned state matches what was saved before the redirect.
 *
 * @returns The code verifier, or null if state is missing, mismatched, or
 *          already consumed. A null result must abort the callback — it
 *          indicates a CSRF attempt or a stale/double-submitted callback.
 */
export function consumePkceState(returnedState: string): string | null {
  const savedState = sessionStorage.getItem(STATE_KEY)

  if (!savedState || savedState !== returnedState) {
    // State mismatch: possible CSRF attack or the user navigated directly to
    // /login/callback without going through the login flow.
    return null
  }

  const verifier = sessionStorage.getItem(`${VERIFIER_KEY_PREFIX}${savedState}`)

  // Clear both entries immediately — verifiers are single-use.
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(`${VERIFIER_KEY_PREFIX}${savedState}`)

  return verifier
}
