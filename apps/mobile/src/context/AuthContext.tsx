import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { isSessionExpired } from '@pegasus/auth'
import type { Session, SignInResult, StoredRefresh } from '../auth/types'
import { isRefreshRejected } from '../auth/authService'
import { setTokenProvider, setUnauthorizedHandler } from '../api/client'
import { logger } from '../utils/logger'
import { storage } from '../utils/storage'
import { unregisterForPush } from '../services/pushNotifications'

const SESSION_KEY = 'pegasus_session'
/**
 * The refresh token lives in its own key, never in the session blob: the
 * session is read on every cold start, and SecureStore caps the size of one value.
 */
const REFRESH_KEY = 'pegasus_refresh'

/** Refresh this long before the ID token's `exp`, so a request never races the expiry. */
const REFRESH_SKEW_SECONDS = 5 * 60
/** A cold start waits at most this long for a refresh before showing the app anyway. */
const COLD_START_REFRESH_WAIT_MS = 8_000
/** Sign-out doesn't wait longer than this for the best-effort token revoke. */
const REVOKE_WAIT_MS = 3_000

/** True when the session's ID token is expired or within the refresh window. */
export function needsRefresh(session: Session, nowMs: number = Date.now()): boolean {
  return session.expiresAt - REFRESH_SKEW_SECONDS <= Math.floor(nowMs / 1000)
}

/** Resolves the promise's value, or `undefined` if it takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}

interface AuthContextType {
  session: Session | null
  isAuthenticated: boolean
  isLoading: boolean
  /**
   * True after the app signed the driver out because the session could no
   * longer be renewed (refresh token expired or revoked, access removed). The
   * login screen shows "your session expired". Cleared by the next sign-in.
   */
  sessionExpired: boolean
  login: (email: string, password: string, tenantId: string) => Promise<void>
  loginWithSso: (tenantId: string, providerId: string) => Promise<void>
  logout: () => Promise<void>
}

type AuthProviderProps = {
  authService: {
    authenticate(email: string, password: string, tenantId: string): Promise<SignInResult>
    authenticateWithSso(tenantId: string, providerId: string): Promise<SignInResult>
    refreshSession(session: Session, refresh: StoredRefresh): Promise<SignInResult>
    revokeRefreshToken(refresh: StoredRefresh): Promise<void>
  }
  children: React.ReactNode
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function readRefresh(): Promise<StoredRefresh | null> {
  const raw = await storage.getItem(REFRESH_KEY)
  return raw ? (JSON.parse(raw) as StoredRefresh) : null
}

/**
 * Persist a sign-in or refresh result: the session and the refresh token, in
 * separate keys. A failed refresh-token write degrades to "no renewal" (the
 * session still works until it expires) rather than failing the sign-in.
 */
async function persist({ session, refresh }: SignInResult): Promise<void> {
  await storage.setItem(SESSION_KEY, JSON.stringify(session))
  try {
    if (refresh) {
      await storage.setItem(REFRESH_KEY, JSON.stringify(refresh))
    } else {
      await storage.deleteItem(REFRESH_KEY)
    }
  } catch (error) {
    logger.warn('Could not store the refresh token — this session will not renew', error)
    await storage.deleteItem(REFRESH_KEY).catch(() => undefined)
  }
}

async function clearStored(): Promise<void> {
  await storage.deleteItem(SESSION_KEY)
  await storage.deleteItem(REFRESH_KEY)
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ authService, children }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  // Derived — never stored as separate useState to avoid sync issues (D-03)
  const isAuthenticated = session !== null

  // The live session for async code (refresh, 401 handler, AppState listener),
  // which must not read a stale render's `session`.
  const sessionRef = useRef<Session | null>(null)
  const serviceRef = useRef(authService)
  serviceRef.current = authService
  const refreshInFlight = useRef<Promise<string | null> | null>(null)

  // Publish the session to React state AND to the API client's bearer-token
  // provider in the same synchronous step. Every transition goes through here.
  //
  // The token binding used to live in a `useEffect([session])` in the root
  // layout, which is one commit too late: `TripsProvider` mounts as a
  // *descendant* of that layout, and React flushes child effects before parent
  // effects. So on the very commit where the session appears — cold-start
  // restore and fresh login alike — the first `GET /me/driver` went out through
  // the previous (null) provider with no Authorization header, and the driver
  // got "Couldn't load your driver" until they tapped Retry. Setting it here,
  // inside the async handler that already has the session in hand, means the
  // token is live *before* the re-render that mounts any consumer, so there is
  // no effect ordering left to lose.
  const applySession = useCallback((next: Session | null) => {
    sessionRef.current = next
    setTokenProvider(() => next?.token ?? null)
    setSession(next)
  }, [])

  /**
   * The session can't be renewed: drop it and send the driver to sign-in with
   * a reason, instead of leaving them "signed in" with a dead token. Push is
   * NOT unregistered — that call would 401 with the dead token, and the device
   * token is taken over by whoever signs in next on this device (upsert per
   * tenant + token).
   */
  const expireSession = useCallback(async () => {
    const email = sessionRef.current?.email ?? ''
    applySession(null)
    setSessionExpired(true)
    try {
      await clearStored()
    } catch (error) {
      logger.error('Error clearing expired session', error)
    }
    logger.info('Session expired — signed out', { email })
  }, [applySession])

  /**
   * Renew the session with the stored refresh token. Single-flight: concurrent
   * callers (a burst of 401s, foreground + 401) share one refresh. Resolves the
   * new ID token, or null when there is none — either the session was ended
   * (rejected refresh) or the failure was transient (offline, 5xx), in which
   * case the session is kept and the next trigger retries.
   */
  const refreshNow = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current
    const current = sessionRef.current
    if (!current) return Promise.resolve(null)

    const run = (async (): Promise<string | null> => {
      try {
        const stored = await readRefresh()
        if (!stored) {
          // Signed in before refresh tokens were kept (or Cognito sent none).
          // Nothing to renew with: end it once it has actually expired.
          if (isSessionExpired(current)) await expireSession()
          return null
        }
        const result = await serviceRef.current.refreshSession(current, stored)
        if (sessionRef.current !== current) return null // signed out or replaced meanwhile
        await persist(result)
        applySession(result.session)
        return result.session.token
      } catch (error) {
        if (sessionRef.current !== current) return null
        if (isRefreshRejected(error)) {
          logger.warn('Session refresh rejected — signing out', error)
          await expireSession()
        } else {
          logger.warn('Session refresh failed — will retry', error)
        }
        return null
      }
    })().finally(() => {
      refreshInFlight.current = null
    })
    refreshInFlight.current = run
    return run
  }, [applySession, expireSession])

  // The API client's 401 handler: refresh once, retry with the new token.
  useEffect(() => {
    setUnauthorizedHandler(refreshNow)
    return () => setUnauthorizedHandler(async () => null)
  }, [refreshNow])

  // Cold-start restore (SESSION-02). An expired or nearly expired session is
  // refreshed BEFORE it is published — restoring it as-is is what used to leave
  // drivers "signed in" with every request failing.
  useEffect(() => {
    const checkSession = async () => {
      try {
        const raw = await storage.getItem(SESSION_KEY)
        if (!raw) return
        const stored = JSON.parse(raw) as Session
        if (!needsRefresh(stored)) {
          applySession(stored)
          return
        }
        sessionRef.current = stored
        const token = await withTimeout(refreshNow(), COLD_START_REFRESH_WAIT_MS)
        // A token means the refreshed session is already published. Otherwise
        // the refresh either ended the session (sessionRef is now null) or is
        // slow / failed transiently: publish the stored session so the app opens;
        // the 401 handler and the next foreground retry the refresh.
        if (!token && sessionRef.current === stored) applySession(stored)
      } catch (error) {
        logger.error('Error restoring session', error)
      } finally {
        setIsLoading(false)
      }
    }
    checkSession()
  }, [applySession, refreshNow]) // both stable — this still runs exactly once

  // Foreground resume (SESSION-04): renew a session that expired, or is about
  // to, while the app was in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const current = sessionRef.current
      if (nextState === 'active' && current !== null && needsRefresh(current)) {
        void refreshNow()
      }
    })
    return () => subscription.remove()
  }, [refreshNow])

  const signedIn = async (result: SignInResult): Promise<void> => {
    await persist(result)
    setSessionExpired(false)
    applySession(result.session)
  }

  const login = async (email: string, password: string, tenantId: string): Promise<void> => {
    try {
      await signedIn(await authService.authenticate(email, password, tenantId))
      logger.logAuth('login', email)
    } catch (error) {
      logger.error('Login failed', error)
      throw error
    }
  }

  const loginWithSso = async (tenantId: string, providerId: string): Promise<void> => {
    try {
      const result = await authService.authenticateWithSso(tenantId, providerId)
      await signedIn(result)
      logger.logAuth('login', result.session.email)
    } catch (error) {
      logger.error('SSO login failed', error)
      throw error
    }
  }

  const logout = async (): Promise<void> => {
    try {
      const email = sessionRef.current?.email ?? ''
      // Deactivate this device's push token BEFORE the session is cleared, so the
      // authenticated DELETE still carries a valid bearer. Best-effort.
      await unregisterForPush(email)
      // Revoke the refresh token so it can't mint sessions after sign-out. Best-effort.
      const stored = await readRefresh().catch(() => null)
      if (stored) {
        await withTimeout(
          authService.revokeRefreshToken(stored).catch((error: unknown) => {
            logger.warn('Refresh token revoke failed', error)
          }),
          REVOKE_WAIT_MS,
        )
      }
      await clearStored()
      applySession(null)
      // A deliberate sign-out isn't an expiry, even if a refresh failed on the way out.
      setSessionExpired(false)
      logger.logAuth('logout', email)
    } catch (error) {
      logger.error('Error logging out', error)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated,
        isLoading,
        sessionExpired,
        login,
        loginWithSso,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
