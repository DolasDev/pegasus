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
  const commonError = useSelector((state: any) => state.common?.error)
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)

  useEffect(() => {
    dispatch(fetchUser())
    // Still fetched so the version slice is populated for diagnostics, but the
    // render gate below no longer depends on it — see the note by the gate.
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

  const snackbar = (
    <Snackbar
      open={!!snackbarMessage}
      message={snackbarMessage ?? ''}
      type="error"
      autoHideDuration={5000}
      onClose={() => setSnackbarMessage(null)}
    />
  )

  // ---------------------------------------------------------------------------
  // Gate.
  //
  // The legacy app additionally gated on a client-version handshake (the on-prem
  // `longhaul_versions` table vs the running Electron app's version) — that
  // existed because auto-updating desktop clients could lag the database schema.
  // This is a web SPA: it's always the latest deployed build, and the on-prem
  // `/version` endpoint doesn't return the legacy `{ clientVersion,
  // supportedVersions: [...] }` shape it expected anyway — so the only
  // meaningful precondition here is "the signed-in user maps to a Long Haul user
  // record" (looked up by `legacyWindowsUsername` → `v_longhaul_salesman`).
  // ---------------------------------------------------------------------------
  if (user) {
    return (
      <>
        {children}
        {snackbar}
      </>
    )
  }

  if (userLoading || userErrorMessage == null) {
    // Loading, or the lookup hasn't started yet (errorMessage is still its
    // initial `null`; a failed lookup sets it to a — possibly empty — string).
    return (
      <>
        <div>Loading...</div>
        {snackbar}
      </>
    )
  }

  return (
    <div className={styles['error-container']}>
      <div>
        <h3>There is a problem with your Driver Planning session</h3>
        {userErrorMessage ? (
          <p>{`Server response: ${userErrorMessage}`}</p>
        ) : (
          <p>Your Cognito user is not mapped to a Long Haul user record.</p>
        )}
        <p>If this issue persists, please contact your admin or email support@dolas.dev</p>
      </div>
      {snackbar}
    </div>
  )
}
