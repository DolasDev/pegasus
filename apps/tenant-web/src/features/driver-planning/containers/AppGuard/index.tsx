import { useEffect, type ReactNode } from 'react'
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

import styles from './AppGuard.module.css'

export function AppGuard({ children }: { children: ReactNode }) {
  const dispatch = useDispatch<any>()
  const userStore = useSelector((state: any) => state.user)
  const versionStore = useSelector((state: any) => state.version)

  useEffect(() => {
    dispatch(fetchUser())
    dispatch(fetchVersion())
    dispatch(fetchDrivers())
    dispatch(fetchTripStatuses())
    dispatch(fetchStates())
    dispatch(fetchZones())
    dispatch(fetchPlanners())
    dispatch(fetchDispatchers())
    dispatch(fetchFilterOptions())
  }, [dispatch])

  useEffect(() => {
    const code = userStore?.user?.code
    if (code) {
      dispatch(loadDefaultFilter(code))
    }
  }, [dispatch, userStore])

  if (userStore.user) {
    return <>{children}</>
  }

  if (userStore.loading || versionStore.loading) {
    return <div>Loading...</div>
  }

  const messages: string[] = []
  if (!userStore.user) {
    messages.push('Your Cognito user is not mapped to a Long Haul user record.')
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
    </div>
  )
}
