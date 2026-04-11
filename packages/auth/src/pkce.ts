// ---------------------------------------------------------------------------
// PKCE — Proof Key for Code Exchange (RFC 7636)
//
// Platform-agnostic PKCE utilities using the standard Web Crypto API.
// Works in browsers, Node.js 20+, and React Native (with expo-crypto polyfill).
// ---------------------------------------------------------------------------

/**
 * Encodes a byte array to base64url (RFC 4648 section 5).
 * base64url differs from standard base64: '+' -> '-', '/' -> '_', no '=' padding.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

/** Generates a cryptographically random PKCE code verifier (RFC 7636 section 4.1). */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(96)) // -> 128-char base64url
  return base64UrlEncode(bytes)
}

/**
 * Computes the S256 PKCE code challenge from a verifier (RFC 7636 section 4.2).
 * Async because SubtleCrypto.digest is always async in the Web Crypto API.
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return base64UrlEncode(new Uint8Array(digest))
}

/** Generates a random state value for CSRF protection. */
export function generateState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64UrlEncode(bytes)
}
