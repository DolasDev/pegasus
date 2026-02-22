import { useEffect, useRef } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { exchangeCode } from '@/auth/cognito'

/**
 * OAuth 2.0 callback handler. Cognito redirects here after a successful login
 * with `?code=...&state=...` in the query string.
 *
 * This component:
 *   1. Reads the authorization code and state from the URL.
 *   2. Exchanges the code for tokens (verifying the CSRF state in the process).
 *   3. Navigates to the tenants list on success, or shows an error on failure.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useSearch({ strict: false }) as Record<string, string>
  const exchanged = useRef(false)

  useEffect(() => {
    // Guard against React StrictMode double-invocation in development.
    if (exchanged.current) return
    exchanged.current = true

    const code = search['code']
    const state = search['state']

    if (!code || !state) {
      void navigate({ to: '/login', replace: true })
      return
    }

    exchangeCode(code, state)
      .then(() => navigate({ to: '/tenants', replace: true }))
      .catch((err: unknown) => {
        console.error('Token exchange failed:', err)
        void navigate({ to: '/login', replace: true })
      })
  }, [navigate, search])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  )
}
