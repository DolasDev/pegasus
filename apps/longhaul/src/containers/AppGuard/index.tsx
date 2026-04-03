import React, { useEffect, useState, type ReactNode } from 'react'
import { fetchUser } from '../../redux/user'
import { fetchVersion } from '../../redux/version'
import { useDispatch, useSelector } from 'react-redux'
import { loadDefaultFilter } from '../../redux/shipments'
import { WINDOWS_USER_KEY } from '../../utils/api/http-client'

import styles from './AppGuard.module.css'

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? 'api-key'

function LoginScreen({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = username.trim()
    if (trimmed) {
      sessionStorage.setItem(WINDOWS_USER_KEY, trimmed)
      onLogin(trimmed)
    }
  }

  return (
    <div className={styles['error-container']}>
      <div>
        <h3>Pegasus Long Haul</h3>
        <p>Enter your Windows username to continue.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Windows username"
            autoFocus
          />{' '}
          <button type="submit">Sign in</button>
        </form>
      </div>
    </div>
  )
}

export function AppGuard({ children }: { children: ReactNode }) {
  const dispatch = useDispatch<any>()
  const userStore = useSelector((state: any) => state.user)
  const versionStore = useSelector((state: any) => state.version)

  // For Windows auth mode, track whether a stored username is present.
  // Initialized from sessionStorage so a page refresh keeps the session.
  const [windowsUserSet, setWindowsUserSet] = useState(
    AUTH_MODE !== 'windows' || !!sessionStorage.getItem(WINDOWS_USER_KEY),
  )

  useEffect(() => {
    if (windowsUserSet) {
      dispatch(fetchUser())
      dispatch(fetchVersion())
    }
  }, [dispatch, windowsUserSet])

  useEffect(() => {
    const code = userStore?.user?.code
    if (code) {
      dispatch(loadDefaultFilter(code))
    }
  }, [dispatch, userStore])

  // Windows auth: no username stored yet — show login form
  if (!windowsUserSet) {
    return <LoginScreen onLogin={() => setWindowsUserSet(true)} />
  }

  if (userStore.user) {
    return children
  }

  if (userStore.loading || versionStore.loading) {
    return <div>Loading...</div>
  }

  const messages: Array<String> = []
  if (!userStore.user) {
    messages.push('You are not registered in the pegasus database.')
  }

  return (
    <div className={styles['error-container']}>
      <div>
        <h3>There is a problem with your application session</h3>
        {messages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
        <p>If this issue persists, please contact your admin or email support@dolas.dev</p>
        {AUTH_MODE === 'windows' && (
          <button
            onClick={() => {
              sessionStorage.removeItem(WINDOWS_USER_KEY)
              setWindowsUserSet(false)
            }}
          >
            Sign in as different user
          </button>
        )}
      </div>
    </div>
  )
}
