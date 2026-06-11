import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  signIn,
  respondToMfaChallenge,
  forgotPassword,
  confirmForgotPassword,
  CognitoError,
} from '@/auth/cognito'

type Step = 'credentials' | 'mfa' | 'forgot-email' | 'forgot-confirm'

const SUBTITLE: Record<Step, string> = {
  credentials: 'Platform administration portal',
  mfa: 'Enter your authenticator code',
  'forgot-email': 'Reset your password',
  'forgot-confirm': 'Enter the code we emailed you',
}

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

  // Forgot-password fields
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

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

  async function handleForgotRequest(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await forgotPassword(email)
      setStep('forgot-confirm')
    } catch (err) {
      const code = err instanceof CognitoError ? err.code : ''
      setError(
        code === 'NotAuthorizedException' || code === 'InvalidParameterException'
          ? 'This account has no password to reset. Contact another administrator.'
          : err instanceof CognitoError
            ? err.message
            : 'Unable to start password reset. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotConfirm(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await confirmForgotPassword(email, resetCode.trim(), newPassword)
      // Return to the sign-in form with a success notice.
      setPassword('')
      setResetCode('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Password updated — sign in with your new password.')
      setStep('credentials')
    } catch (err) {
      setError(
        err instanceof CognitoError ? err.message : 'Failed to reset password. Please try again.',
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
          <p className="text-sm text-muted-foreground">{SUBTITLE[step]}</p>
        </div>

        {notice && step === 'credentials' && (
          <div className="rounded-md border border-primary/40 bg-primary/5 px-4 py-3 text-sm text-foreground">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 'credentials' && (
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

            <button
              type="button"
              onClick={() => {
                setError(null)
                setNotice(null)
                setStep('forgot-email')
              }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
          </form>
        )}

        {step === 'mfa' && (
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

        {step === 'forgot-email' && (
          <form onSubmit={(e) => void handleForgotRequest(e)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="forgot-email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
                placeholder="admin@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset code'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('credentials')
                setError(null)
              }}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {step === 'forgot-confirm' && (
          <form onSubmit={(e) => void handleForgotConfirm(e)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="reset-code" className="text-sm font-medium text-foreground">
                Confirmation code
              </label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                required
                autoComplete="one-time-code"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="reset-new-password" className="text-sm font-medium text-foreground">
                New password
              </label>
              <input
                id="reset-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="reset-confirm-password"
                className="text-sm font-medium text-foreground"
              >
                Confirm password
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Updating…' : 'Set new password'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('forgot-email')
                setError(null)
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
