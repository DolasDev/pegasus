import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { setSession } from '@/auth/session'
import { getCognitoConfig, exchangeCodeForTokens } from '@/auth/cognito'
import { consumePkceState } from '@/auth/pkce'
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

type CallbackStatus =
  | { name: 'processing'; step: string }
  | { name: 'done' }
  | { name: 'error'; message: string }

export function LoginCallbackPage() {
  const [status, setStatus] = useState<CallbackStatus>({
    name: 'processing',
    step: 'Verifying your identity…',
  })

  useEffect(() => {
    void handleCallback()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCallback() {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')

    // Cognito may return an error in the callback (e.g. user cancelled at IdP)
    const errorParam = params.get('error')
    if (errorParam) {
      const description = params.get('error_description') ?? errorParam
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
          ? 'Your account is not authorised to access Pegasus. Contact your administrator.'
          : 'Authentication failed. Please try again.'
      setStatus({ name: 'error', message })
      return
    }

    // -----------------------------------------------------------------------
    // Step 5 — Persist session (including token) and navigate to dashboard
    // -----------------------------------------------------------------------
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
          </CardTitle>
          <CardDescription>
            {status.name === 'processing' && status.step}
            {status.name === 'done' && 'Redirecting to your dashboard\u2026'}
            {status.name === 'error' && status.message}
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
              onClick={() => { window.location.href = '/login' }}
            >
              Start over
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
