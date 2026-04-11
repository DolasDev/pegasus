// ---------------------------------------------------------------------------
// PKCE — re-exports shared utilities from @pegasus/auth and adds
// app-specific sessionStorage helpers for the tenant web SPA.
// ---------------------------------------------------------------------------

export { generateCodeVerifier, generateCodeChallenge, generateState } from '@pegasus/auth'

const STATE_KEY = 'pegasus.oauth.state'
const VERIFIER_KEY_PREFIX = 'pegasus.pkce.'

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
    return null
  }

  const verifier = sessionStorage.getItem(`${VERIFIER_KEY_PREFIX}${savedState}`)

  // Clear both entries immediately — verifiers are single-use.
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(`${VERIFIER_KEY_PREFIX}${savedState}`)

  return verifier
}
