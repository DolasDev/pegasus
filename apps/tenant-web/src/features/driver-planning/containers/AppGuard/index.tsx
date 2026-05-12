import { useEffect, useState, type ReactNode } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchUser } from '../../redux/user'
import { fetchVersion } from '../../redux/version'
import { loadDefaultFilter } from '../../redux/shipments'
import {
  fetchDrivers,
  fetchTripStatuses,
  fetchStates,
  fetchZones,
  fetchPlanners,
  fetchDispatchers,
  fetchFilterOptions,
} from '../../redux/common'
import { Snackbar } from '../../components/Snackbar'

import styles from './AppGuard.module.css'

// Reference-data thunks that hydrate dropdowns/lookups. Failures should not
// block the page — we surface them via the snackbar but still render children.
const REFERENCE_DATA_THUNKS = [
  ['drivers', fetchDrivers],
  ['trip statuses', fetchTripStatuses],
  ['states', fetchStates],
  ['zones', fetchZones],
  ['planners', fetchPlanners],
  ['dispatchers', fetchDispatchers],
  ['filter options', fetchFilterOptions],
] as const

export function AppGuard({ children }: { children: ReactNode }) {
  const dispatch = useDispatch<any>()
  const userStore = useSelector((state: any) => state.user)
  const versionStore = useSelector((state: any) => state.version)
  const commonError = useSelector((state: any) => state.common?.error)
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)

  useEffect(() => {
    dispatch(fetchUser())
    dispatch(fetchVersion())

    for (const [label, thunk] of REFERENCE_DATA_THUNKS) {
      Promise.resolve(dispatch(thunk())).catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err)
        setSnackbarMessage(`Failed to load ${label}: ${detail}`)
      })
    }
  }, [dispatch])

  // Some reference-data thunks (e.g. fetchDrivers) catch their own errors and
  // dispatch a failure action rather than re-throwing — surface those via the
  // snackbar too so the user sees the problem.
  useEffect(() => {
    if (typeof commonError === 'string' && commonError.length > 0) {
      setSnackbarMessage(`Failed to load reference data: ${commonError}`)
    }
  }, [commonError])

  useEffect(() => {
    const code = userStore?.user?.code
    if (code) {
      dispatch(loadDefaultFilter(code))
    }
  }, [dispatch, userStore])

  const { user, loading: userLoading, errorMessage: userErrorMessage } = userStore
  const {
    loading: versionLoading,
    clientVersion,
    serverVersion,
    supportedVersions,
    errorMessage: versionErrorMessage,
  } = versionStore

  const versionsLoaded = !!clientVersion && Array.isArray(supportedVersions)
  const versionsMatch = versionsLoaded && supportedVersions.includes(clientVersion)

  const snackbar = (
    <Snackbar
      open={!!snackbarMessage}
      message={snackbarMessage ?? ''}
      type="error"
      autoHideDuration={5000}
      onClose={() => setSnackbarMessage(null)}
    />
  )

  if (user && versionsMatch) {
    return (
      <>
        {children}
        {snackbar}
      </>
    )
  }

  if (userLoading || versionLoading || (user && !versionsLoaded)) {
    return (
      <>
        <div>Loading...</div>
        {snackbar}
      </>
    )
  }

  const messages: string[] = []
  if (!user) {
    messages.push(
      userErrorMessage
        ? `Server response: ${userErrorMessage}`
        : 'Your Cognito user is not mapped to a Long Haul user record.',
    )
  }
  if (versionsLoaded && !versionsMatch) {
    messages.push(
      `Your application version (${clientVersion}) is not compatible with the current version of the database (${serverVersion}).`,
    )
    messages.push('If there is an available update for your app, please accept it now.')
    messages.push(`Supported Application Versions: ${supportedVersions.join(',')}`)
  } else if (!versionsLoaded && versionErrorMessage) {
    messages.push(`Unable to verify application version: ${versionErrorMessage}`)
  }

  return (
    <div className={styles['error-container']}>
      <div>
        <h3>There is a problem with your Driver Planning session</h3>
        {messages.map((message, index) => (
          <p key={index}>{message}</p>
        ))}
        <p>If this issue persists, please contact your admin or email support@dolas.dev</p>
      </div>
      {snackbar}
    </div>
  )
}
