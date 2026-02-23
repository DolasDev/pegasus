import { useState, useEffect } from 'react'
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
import { ApiError } from '@/api/client'
import {
  getCognitoConfig,
  buildAuthorizeUrl,
} from '@/auth/cognito'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  savePkceState,
} from '@/auth/pkce'

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
        setStep({
          name: 'error',
          message:
            'Your organisation has not configured SSO yet. Contact your administrator to set up a sign-in provider.',
        })
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
      setStep({
        name: 'error',
        message:
          'Your organisation has no SSO providers configured. Contact your administrator.',
      })
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
