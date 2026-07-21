import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle, UserX } from 'lucide-react'
import { findSsoErrorMarker, type SsoErrorMarker } from '@pegasus/domain'
import { normalizeEmail } from '@pegasus/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { setSession } from '@/auth/session'
import { getCognitoConfig, exchangeCodeForTokens } from '@/auth/cognito'
import { consumePkceState } from '@/auth/pkce'
import { readSsoContext, clearSsoContext, type SsoContext } from '@/auth/sso-context'
import { startIdpSignOut } from '@/auth/idp-signout'
import { apiFetch, ApiError } from '@/api/client'
import type { Session } from '@/auth/session'

// ---------------------------------------------------------------------------
// LoginCallbackPage — Phase 2: real Authorization Code + PKCE flow
//
// This route handles the redirect from the Cognito Hosted UI after the user
// authenticates with their IdP. The URL will contain:
//   ?code=<authorization_code>&state=<csrf_state>
//
// Full callback sequence:
//   1. Read `code` and `state` from the URL query string.
//   2. Validate `state` against sessionStorage (CSRF guard). Abort if missing
//      or mismatched — this prevents code injection from attacker-controlled
//      redirects.
//   3. Exchange `code` + `code_verifier` for tokens at the Cognito token
//      endpoint (POST directly to Cognito from the browser — no proxy needed
//      because this is a public app client with no client_secret).
//   4. POST the ID token to our backend for server-side validation:
//        POST /api/auth/validate-token { idToken: string }
//      The backend verifies signature (JWKS), iss, aud, exp, token_use, then
//      extracts sub, tenantId (from email domain lookup), role, email, and exp.
//      Raw tokens are never stored — only the validated session claims.
//   5. Persist the session and navigate to /dashboard.
//
// Token storage decision:
//   The raw ID and access tokens are discarded after validation. The backend
//   validate-token endpoint returns only the non-sensitive claims (sub,
//   tenantId, role, email, expiresAt). These are stored in sessionStorage.
//
//   Rationale for sessionStorage over httpOnly cookies: the existing
//   architecture uses API Gateway + Lambda on a different origin from the
//   CloudFront-hosted SPA. Setting cross-origin httpOnly cookies from Lambda
//   requires Vary: Origin CORS and SameSite=None; Secure — which works in
//   production but introduces complexity and requires the Lambda to know the
//   exact frontend origin at deploy time. sessionStorage is a pragmatic choice
//   that is safe because:
//     a) sessionStorage is scoped to the browser tab — cleared on close.
//     b) The application uses HTTPS exclusively in production.
//     c) The stored values are validated session claims, not raw tokens.
//     d) Phase 5 adds backend token re-validation on every API request via
//        the Authorization: Bearer header, so the session is re-checked
//        server-side regardless of what sessionStorage holds.
//
// Error surface:
//   Any failure in steps 2-4 shows an error screen and a "Start over" link.
//   We never silently fall back — a failed callback means the user must
//   restart so there is no ambiguity about the session state.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wrong-account recovery
//
// Three distinct ways a federated sign-in ends up as the wrong person, and all
// three arrive here differently:
//
//   1. IdP asserted no email       → pre-token throws, marker SSO_ERROR_NO_EMAIL
//   2. IdP asserted an unrostered  → pre-token throws, marker SSO_ERROR_NOT_ROSTERED
//      email
//   3. IdP asserted a DIFFERENT    → nothing throws at all. The other account is
//      rostered email                 rostered, so a perfectly valid session is
//                                     issued — for the wrong person.
//
// Cases 1 and 2 are detected by matching our own marker in `error_description`
// (see @pegasus/domain findSsoErrorMarker for why a marker and not the prose).
// Case 3 is detected HERE, after the token exchange, by comparing the validated
// session's email against the one the user typed — which only this side knows,
// because nothing in the PreTokenGeneration event carries the original authorize
// request (see the note at pre-token.ts's AuthSession lookup).
//
// The case-3 check is a usability guard, NOT a security boundary: the user did
// authenticate as that other person and is entitled to that session, so bypassing
// this check gains an attacker exactly nothing. What it prevents is the silent
// outcome — two coworkers on a shared machine, one types their own address and
// lands in the other's account with the other's roles, with nothing on screen
// saying so.
// ---------------------------------------------------------------------------
type WrongAccountReason = SsoErrorMarker | 'session-email-mismatch'

type CallbackStatus =
  | { name: 'processing'; step: string }
  | { name: 'done' }
  | {
      name: 'wrong-account'
      reason: WrongAccountReason
      context: SsoContext
      /** The account the IdP actually authenticated — known only in case 3. */
      actualEmail?: string
    }
  | { name: 'error'; message: string }

/** User-facing explanation for each way the wrong account can arrive here. */
function describeWrongAccount(status: Extract<CallbackStatus, { name: 'wrong-account' }>): string {
  const { context, reason, actualEmail } = status
  const asked = `You asked to sign in as ${context.email}`

  switch (reason) {
    case 'session-email-mismatch':
      return `${asked}, but ${context.providerName} signed you in as ${actualEmail ?? 'a different account'}. Sign out of ${context.providerName} and try again.`
    case 'PEGASUS_IDP_NOT_ROSTERED':
      return `${asked}, but ${context.providerName} signed you in with an account that is not registered for this organization. This usually means a different account is already signed in to ${context.providerName} in this browser.`
    case 'PEGASUS_IDP_NO_EMAIL':
      return `${asked}, but ${context.providerName} did not provide an email address for the account it signed you in with. That is usually a different account than the one you asked for — sign out and try again. If it keeps happening, ask your administrator to check that your account has an email address set.`
  }
}

export function LoginCallbackPage() {
  const [status, setStatus] = useState<CallbackStatus>({
    name: 'processing',
    step: 'Verifying your identity…',
  })
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    void handleCallback()
  }, [])

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    // Cognito may return an error in the callback (e.g. user canceled at IdP)
    const errorParam = params.get('error')
    if (errorParam) {
      const description = params.get('error_description') ?? errorParam

      // Our own marker (cases 1 and 2 above) — offer the IdP sign-out instead of
      // showing the user a raw AWS exception they cannot act on. Needs the login
      // context to name the account they asked for; without it there is nothing
      // useful to say, so fall through to the generic error.
      const marker = findSsoErrorMarker(description)
      const context = readSsoContext()
      if (marker && context) {
        setStatus({ name: 'wrong-account', reason: marker, context })
        return
      }

      setStatus({ name: 'error', message: `Sign-in failed: ${description}` })
      return
    }

    if (!code || !state) {
      setStatus({
        name: 'error',
        message: 'Invalid callback: missing authorization code or state. Please try again.',
      })
      return
    }

    // -----------------------------------------------------------------------
    // Step 2 — Validate state (CSRF guard)
    //
    // consumePkceState reads and clears both the state and verifier from
    // sessionStorage. A null return means state mismatch or replay — abort.
    // -----------------------------------------------------------------------
    const verifier = consumePkceState(state)
    if (!verifier) {
      setStatus({
        name: 'error',
        message:
          'Security check failed: the sign-in state is invalid or expired. Please start over.',
      })
      return
    }

    // -----------------------------------------------------------------------
    // Step 3 — Exchange code for tokens at the Cognito token endpoint
    // -----------------------------------------------------------------------
    setStatus({ name: 'processing', step: 'Exchanging authorization code…' })

    let idToken: string
    try {
      const config = getCognitoConfig()
      const tokens = await exchangeCodeForTokens(config, code, verifier)
      idToken = tokens.id_token
    } catch (err) {
      console.error('Token exchange failed', err)
      setStatus({
        name: 'error',
        message: 'Failed to complete sign-in. Please try again.',
      })
      return
    }

    // -----------------------------------------------------------------------
    // Step 4 — Send ID token to backend for validation + session claim extraction
    //
    // The backend verifies: RS256 signature (JWKS), iss (user pool), aud
    // (tenant client ID), exp, token_use = "id". It then resolves tenantId
    // from the email domain and returns the validated session claims.
    //
    // Raw tokens are discarded after this call — only the session claims
    // (sub, tenantId, role, email, expiresAt) are stored.
    // -----------------------------------------------------------------------
    setStatus({ name: 'processing', step: 'Establishing your session…' })

    let session: Session
    try {
      session = await apiFetch<Session>('/api/auth/validate-token', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      })
    } catch (err) {
      console.error('Token validation failed', err)
      const message =
        err instanceof ApiError && err.status === 403
          ? 'Your account is not authorized to access Pegasus. Contact your administrator.'
          : 'Authentication failed. Please try again.'
      setStatus({ name: 'error', message })
      return
    }

    // -----------------------------------------------------------------------
    // Step 5 — Confirm we signed in as the account the user actually asked for
    //
    // Case 3 above: the IdP authenticated a different account that happens to be
    // on the same tenant's roster, so everything upstream succeeded. Only the
    // typed email — which never leaves this browser — can catch it.
    //
    // Guarded on having a context AND an SSO login: a password login has no IdP
    // session to sign out of, and a missing context means we cannot know what was
    // asked for. In both cases the session stands rather than being refused on a
    // fact we do not have.
    // -----------------------------------------------------------------------
    const ssoContext = readSsoContext()
    if (ssoContext && normalizeEmail(session.email) !== normalizeEmail(ssoContext.email)) {
      setStatus({
        name: 'wrong-account',
        reason: 'session-email-mismatch',
        context: ssoContext,
        actualEmail: session.email,
      })
      return
    }

    // -----------------------------------------------------------------------
    // Step 6 — Persist session (including token) and navigate to dashboard
    // -----------------------------------------------------------------------
    clearSsoContext()
    setSession({ ...session, token: idToken })
    setStatus({ name: 'done' })

    // Replace history entry so the Back button skips /login/callback
    window.location.replace('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <span className="text-2xl font-bold tracking-tight">Pegasus</span>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status.name === 'processing' && (
              <>
                <Loader2 size={18} className="animate-spin" />
                Completing sign-in
              </>
            )}
            {status.name === 'done' && (
              <>
                <CheckCircle2 size={18} className="text-green-600" />
                Signed in
              </>
            )}
            {status.name === 'error' && (
              <>
                <AlertCircle size={18} className="text-destructive" />
                Sign-in failed
              </>
            )}
            {status.name === 'wrong-account' && (
              <>
                <UserX size={18} className="text-destructive" />
                Wrong account
              </>
            )}
          </CardTitle>
          <CardDescription>
            {status.name === 'processing' && status.step}
            {status.name === 'done' && 'Redirecting to your dashboard\u2026'}
            {status.name === 'error' && status.message}
            {status.name === 'wrong-account' && describeWrongAccount(status)}
          </CardDescription>
        </CardHeader>

        {status.name === 'processing' && (
          <CardContent className="flex justify-center py-6">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </CardContent>
        )}

        {status.name === 'error' && (
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = '/login'
              }}
            >
              Start over
            </Button>
          </CardContent>
        )}

        {status.name === 'wrong-account' && (
          <CardContent className="space-y-2">
            <Button
              className="w-full"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true)
                // Clear our own scratch first: whatever happens to the redirect
                // chain, the next login must start from a clean slate.
                const { tenantId, providerId } = status.context
                clearSsoContext()
                void startIdpSignOut(tenantId, providerId)
              }}
            >
              {signingOut ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Signing out…
                </>
              ) : (
                `Sign out of ${status.context.providerName} and try again`
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={signingOut}
              onClick={() => {
                clearSsoContext()
                window.location.href = '/login'
              }}
            >
              Back to sign-in
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
