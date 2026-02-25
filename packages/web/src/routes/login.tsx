import { useState, useEffect, type FormEvent } from 'react'
import { ArrowRight, Loader2, AlertCircle, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  resolveTenantByDomain,
  type TenantResolution,
  type TenantProvider,
} from '@/auth/tenant-resolver'
import { apiFetch, ApiError } from '@/api/client'
import {
  getCognitoConfig,
  buildAuthorizeUrl,
  signIn,
  respondToMfaChallenge,
  respondToNewPasswordChallenge,
} from '@/auth/cognito'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  savePkceState,
} from '@/auth/pkce'
import { setSession } from '@/auth/session'
import type { Session } from '@/auth/session'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts the domain from an email string. Returns null for invalid input. */
function extractDomain(email: string): string | null {
  const parts = email.trim().toLowerCase().split('@')
  if (parts.length !== 2 || !parts[1]) return null
  return parts[1]
}

// ---------------------------------------------------------------------------
// Step union type — drives the multi-step UI as a state machine.
// The shape is identical to Phase 1; only the "redirecting" step's action changed.
// ---------------------------------------------------------------------------
type Step =
  | { name: 'email' }
  | { name: 'resolving' }
  | { name: 'select-provider'; resolution: TenantResolution }
  | { name: 'redirecting'; provider: TenantProvider; tenantId: string; email: string }
  | { name: 'password' }
  | { name: 'mfa'; session: string; username: string }
  | { name: 'new-password'; session: string; username: string }
  | { name: 'error'; message: string }

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<Step>({ name: 'email' })

  // -------------------------------------------------------------------------
  // Step 1 — Email submission
  // -------------------------------------------------------------------------
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()

    const domain = extractDomain(email)
    if (!domain) {
      setStep({ name: 'error', message: 'Please enter a valid work email address.' })
      return
    }

    setStep({ name: 'resolving' })

    let resolution: TenantResolution | null
    try {
      resolution = await resolveTenantByDomain(domain)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SSO_NOT_CONFIGURED') {
        // SSO not yet configured — offer direct Cognito password login.
        setStep({ name: 'password' })
      } else {
        setStep({
          name: 'error',
          message: 'Unable to reach the authentication service. Please try again.',
        })
      }
      return
    }

    if (!resolution) {
      setStep({
        name: 'error',
        message: `The domain "${domain}" is not registered with Pegasus. Contact your administrator.`,
      })
      return
    }

    if (resolution.providers.length === 0) {
      // Tenant domain is registered but no SSO providers configured yet.
      // Show password login so the tenant admin can sign in to set up SSO.
      setStep({ name: 'password' })
      return
    }

    if (resolution.providers.length === 1) {
      // Single provider — skip the selection screen.
      const [provider] = resolution.providers
      setStep({
        name: 'redirecting',
        provider: provider!,
        tenantId: resolution.tenantId,
        email,
      })
    } else {
      setStep({ name: 'select-provider', resolution })
    }
  }

  // -------------------------------------------------------------------------
  // Step 2b — Provider selected from multi-provider list
  // -------------------------------------------------------------------------
  function handleProviderSelect(provider: TenantProvider, resolution: TenantResolution) {
    setStep({ name: 'redirecting', provider, tenantId: resolution.tenantId, email })
  }

  // -------------------------------------------------------------------------
  // Step 2c — Direct password login (no SSO providers configured)
  // -------------------------------------------------------------------------
  async function handlePasswordSubmit(e: FormEvent, password: string) {
    e.preventDefault()
    try {
      const result = await signIn(email, password)
      if (result.type === 'mfa') {
        setStep({ name: 'mfa', session: result.session, username: result.username })
      } else if (result.type === 'new_password_required') {
        setStep({ name: 'new-password', session: result.session, username: result.username })
      } else {
        await completePasswordSession(result.idToken)
      }
    } catch (err) {
      setStep({
        name: 'error',
        message: err instanceof Error ? err.message : 'Sign-in failed. Please try again.',
      })
    }
  }

  async function handleMfaSubmit(e: FormEvent, session: string, username: string, code: string) {
    e.preventDefault()
    try {
      const { idToken } = await respondToMfaChallenge(session, username, code)
      await completePasswordSession(idToken)
    } catch (err) {
      setStep({
        name: 'error',
        message:
          err instanceof Error ? err.message : 'MFA verification failed. Please try again.',
      })
    }
  }

  async function handleNewPasswordSubmit(
    e: FormEvent,
    session: string,
    username: string,
    newPassword: string,
  ) {
    e.preventDefault()
    try {
      const { idToken } = await respondToNewPasswordChallenge(session, username, newPassword)
      await completePasswordSession(idToken)
    } catch (err) {
      setStep({
        name: 'error',
        message: err instanceof Error ? err.message : 'Failed to set new password. Please try again.',
      })
    }
  }

  /** Validates the ID token via the API and stores the session — mirrors the SSO callback. */
  async function completePasswordSession(idToken: string) {
    const session = await apiFetch<Session>('/api/auth/validate-token', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    })
    setSession({ ...session, token: idToken })
    window.location.replace('/dashboard')
  }

  // -------------------------------------------------------------------------
  // Step 3 — Initiate the Authorization Code + PKCE redirect
  //
  // Phase 2: generates a real PKCE verifier/challenge and state, then performs
  // a full-page redirect to the Cognito Hosted UI. Cognito handles the IdP
  // authentication and redirects back to /login/callback with `code` + `state`.
  //
  // The verifier and state are stored in sessionStorage so the callback can
  // validate the state (CSRF check) and prove ownership of the code (PKCE).
  //
  // The `identity_provider` parameter routes directly to the tenant's IdP —
  // no Hosted UI login form is shown. Works for both OIDC and SAML providers.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (step.name !== 'redirecting') return

    const provider = step.provider

    // Async work wrapped in an immediately-invoked async function to satisfy
    // the useEffect return-type constraint (must be synchronous or a cleanup).
    void (async () => {
      try {
        const config = getCognitoConfig()
        const verifier = generateCodeVerifier()
        const [challenge, state] = await Promise.all([
          generateCodeChallenge(verifier),
          Promise.resolve(generateState()),
        ])

        // Persist before redirecting — the callback reads these.
        savePkceState(state, verifier)

        const authorizeUrl = buildAuthorizeUrl(config, provider.id, challenge, state)

        // Full-page redirect to Cognito Hosted UI. Browser leaves the SPA;
        // React state is discarded. The callback route handles the return.
        window.location.href = authorizeUrl
      } catch (err) {
        // Likely a missing env var or PKCE crypto failure.
        console.error('Failed to build Cognito authorize URL', err)
        setStep({
          name: 'error',
          message: 'Authentication configuration error. Please contact your administrator.',
        })
      }
    })()
  }, [step])

  // -------------------------------------------------------------------------
  // Render — identical to Phase 1; only the redirecting step's action changed.
  // -------------------------------------------------------------------------
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Wordmark */}
      <div className="mb-8 text-center">
        <span className="text-2xl font-bold tracking-tight">Pegasus</span>
        <p className="mt-1 text-sm text-muted-foreground">Move Management Platform</p>
      </div>

      <Card className="w-full max-w-sm">
        {/* ── Step: email ────────────────────────────────── */}
        {step.name === 'email' && (
          <>
            <CardHeader>
              <CardTitle>Sign in</CardTitle>
              <CardDescription>Enter your work email to continue with SSO.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  void handleEmailSubmit(e)
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full gap-2">
                  Continue
                  <ArrowRight size={16} />
                </Button>
              </form>
            </CardContent>
          </>
        )}

        {/* ── Step: resolving ────────────────────────────── */}
        {step.name === 'resolving' && (
          <>
            <CardHeader>
              <CardTitle>Looking up your organisation</CardTitle>
              <CardDescription>{email}</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center py-8">
              <Loader2 size={32} className="animate-spin text-muted-foreground" />
            </CardContent>
          </>
        )}

        {/* ── Step: select-provider ──────────────────────── */}
        {step.name === 'select-provider' && (
          <>
            <CardHeader>
              <CardTitle>Choose your sign-in method</CardTitle>
              <CardDescription>
                {step.resolution.tenantName} has {step.resolution.providers.length} providers
                configured. Select one to continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {step.resolution.providers.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => handleProviderSelect(provider, step.resolution)}
                >
                  <LogIn size={16} />
                  {provider.name}
                  <span className="ml-auto text-xs uppercase text-muted-foreground">
                    {provider.type}
                  </span>
                </Button>
              ))}
              <button
                type="button"
                onClick={() => setStep({ name: 'email' })}
                className="w-full pt-1 text-center text-xs text-muted-foreground hover:underline"
              >
                Use a different email
              </button>
            </CardContent>
          </>
        )}

        {/* ── Step: redirecting ──────────────────────────── */}
        {step.name === 'redirecting' && (
          <>
            <CardHeader>
              <CardTitle>Redirecting</CardTitle>
              <CardDescription>
                Taking you to {step.provider.name}&hellip;
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center py-8">
              <Loader2 size={32} className="animate-spin text-muted-foreground" />
            </CardContent>
          </>
        )}

        {/* ── Step: password ─────────────────────────────── */}
        {step.name === 'password' && (
          <PasswordForm
            email={email}
            onSubmit={handlePasswordSubmit}
            onBack={() => setStep({ name: 'email' })}
          />
        )}

        {/* ── Step: mfa ──────────────────────────────────── */}
        {step.name === 'mfa' && (
          <MfaForm
            session={step.session}
            username={step.username}
            onSubmit={handleMfaSubmit}
            onBack={() => setStep({ name: 'password' })}
          />
        )}

        {/* ── Step: new-password ─────────────────────────── */}
        {step.name === 'new-password' && (
          <NewPasswordForm
            session={step.session}
            username={step.username}
            onSubmit={handleNewPasswordSubmit}
            onBack={() => setStep({ name: 'password' })}
          />
        )}

        {/* ── Step: error ────────────────────────────────── */}
        {step.name === 'error' && (
          <>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle size={18} />
                Unable to continue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{step.message}</p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setStep({ name: 'email' })}
              >
                Try again
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PasswordForm — renders inside the Card when no SSO providers are configured
// ---------------------------------------------------------------------------

function PasswordForm({
  email,
  onSubmit,
  onBack,
}: {
  email: string
  onSubmit: (e: FormEvent, password: string) => Promise<void>
  onBack: () => void
}) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    setLoading(true)
    try {
      await onSubmit(e, password)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>{email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Sign in'}
          </Button>
        </form>
        <button
          type="button"
          onClick={onBack}
          className="w-full pt-1 text-center text-xs text-muted-foreground hover:underline"
        >
          Use a different email
        </button>
      </CardContent>
    </>
  )
}

// ---------------------------------------------------------------------------
// NewPasswordForm — renders when Cognito returns a NEW_PASSWORD_REQUIRED challenge
// (admin-created users must set a permanent password on first sign-in)
// ---------------------------------------------------------------------------

function NewPasswordForm({
  session,
  username,
  onSubmit,
  onBack,
}: {
  session: string
  username: string
  onSubmit: (
    e: FormEvent,
    session: string,
    username: string,
    newPassword: string,
  ) => Promise<void>
  onBack: () => void
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (newPassword !== confirm) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setLoading(true)
    try {
      await onSubmit(e, session, username, newPassword)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>
          Your account requires a permanent password before you can continue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          {mismatch && (
            <p className="text-sm text-destructive">Passwords do not match.</p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Set password'}
          </Button>
        </form>
        <button
          type="button"
          onClick={onBack}
          className="w-full pt-1 text-center text-xs text-muted-foreground hover:underline"
        >
          ← Back
        </button>
      </CardContent>
    </>
  )
}

// ---------------------------------------------------------------------------
// MfaForm — renders when Cognito returns a SOFTWARE_TOKEN_MFA challenge
// ---------------------------------------------------------------------------

function MfaForm({
  session,
  username,
  onSubmit,
  onBack,
}: {
  session: string
  username: string
  onSubmit: (e: FormEvent, session: string, username: string, code: string) => Promise<void>
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    setLoading(true)
    try {
      await onSubmit(e, session, username, code)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>Enter the code from your authenticator app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="totp">Authenticator code</Label>
            <Input
              id="totp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoComplete="one-time-code"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              className="text-center tracking-widest"
              placeholder="000000"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
          </Button>
        </form>
        <button
          type="button"
          onClick={onBack}
          className="w-full pt-1 text-center text-xs text-muted-foreground hover:underline"
        >
          ← Back
        </button>
      </CardContent>
    </>
  )
}
