import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { signIn, respondToMfaChallenge, CognitoError } from '@/auth/cognito'

type Step = 'credentials' | 'mfa'

interface MfaState {
  session: string
  username: string
}

/** Public login page. Authenticates directly against Cognito (no Hosted UI redirect). */
export function LoginPage() {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('credentials')
  const [mfaState, setMfaState] = useState<MfaState | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCredentials(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const result = await signIn(email, password)
      if (result.type === 'mfa') {
        setMfaState({ session: result.session, username: result.username })
        setStep('mfa')
      } else {
        await navigate({ to: '/tenants', replace: true })
      }
    } catch (err) {
      setError(err instanceof CognitoError ? err.message : 'Sign-in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault()
    if (!mfaState) return
    setLoading(true)
    setError(null)
    try {
      await respondToMfaChallenge(mfaState.session, mfaState.username, totp)
      await navigate({ to: '/tenants', replace: true })
    } catch (err) {
      setError(
        err instanceof CognitoError ? err.message : 'MFA verification failed. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Pegasus Admin</h1>
          <p className="text-sm text-muted-foreground">
            {step === 'credentials'
              ? 'Platform administration portal'
              : 'Enter your authenticator code'}
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 'credentials' ? (
          <form onSubmit={(e) => void handleCredentials(e)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
                placeholder="admin@example.com"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleMfa(e)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="totp" className="text-sm font-medium text-foreground">
                Authenticator code
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                required
                autoComplete="one-time-code"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-sm tracking-widest text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('credentials')
                setError(null)
                setTotp('')
              }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
