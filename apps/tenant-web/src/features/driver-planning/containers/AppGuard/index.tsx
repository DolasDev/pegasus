import { useEffect, useState, type ReactNode } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchUser } from '../../redux/user'
import { fetchVersion } from '../../redux/version'
import { loadDefaultFilter } from '../../redux/shipments'
import { fetchReferenceData } from '../../redux/common'
import { Snackbar } from '../../components/Snackbar'

import styles from './AppGuard.module.css'

export function AppGuard({ children }: { children: ReactNode }) {
  const dispatch = useDispatch<any>()
  const userStore = useSelector((state: any) => state.user)
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null)

  useEffect(() => {
    dispatch(fetchUser())
    // Still fetched so the version slice is populated for diagnostics, but the
    // render gate below no longer depends on it — see the note by the gate.
    dispatch(fetchVersion())

    // All seven reference-data lookups (drivers, trip-statuses, states, zones,
    // planners, dispatchers, filter-options) are batched into a single cloud
    // request — fetchReferenceData hits one `/onprem/longhaul/reference-data`
    // endpoint that runs one multi-statement MSSQL batch and then fans the
    // result back into the existing per-slice success reducers. This drops
    // bootstrap from ~9 api Lambda invocations to ~3 and removes the
    // concurrency-throttle failure mode we used to surface as the
    // per-lookup-aggregated "Failed to load reference data" toast.
    Promise.resolve(dispatch(fetchReferenceData())).catch((err: any) => {
      const detail = err?.message ?? 'unknown error'
      setSnackbarMessage(`Failed to load reference data: ${detail}`)
    })
  }, [dispatch])

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
