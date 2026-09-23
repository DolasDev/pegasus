import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { Link } from '@/features/driver-planning/utils/router-compat'

import { Lane } from '../../components/Lane'
import { fetchTrips } from '../../redux/trips'
import { API } from '../../utils/api'
import { TripCard } from './components/TripCard'
import styles from './Trips.module.css'
import { TripsFilter } from './components/TripsFilter'
import { useDebounce } from '../../utils/hooks/use-debounce'
import { Button } from '@/features/driver-planning/components/Button'
import { useAppDispatch } from '../../redux/hooks'
import type { RootState } from '../../redux/store'
import { splitRejectedStatus } from '../../utils/rejected-status-filter'

const MemoizedTripCards = React.memo(({ trips }: { trips: any[] }) => {
  return trips.map((trip: any) => <TripCard key={trip.archivedTripId ?? trip.id} trip={trip} />)
})

export function Trips() {
  const trips = useSelector((state: RootState) => state.trips.tripList)
  const query = useSelector((state: RootState) => state.trips.query)
  const loading = useSelector((state: RootState) => state.shipments.loading)

  // Rejected-trip snapshots are stored cloud-side in Postgres, separate from the
  // MSSQL live-trip list. They are surfaced inline (badged) in two cases:
  //   - the list is filtered by a driver — that driver's rejected offers show
  //     up "in their trips" (the original #290 behaviour); or
  //   - "Rejected" is picked in the Status filter, which is a synthetic option
  //     the legacy MasterTripStatus table knows nothing about.
  // With both set, the driver still narrows the snapshots.
  const [rejectedTrips, setRejectedTrips] = useState<any[]>([])

  const debouncedQuery = useDebounce(query, 300)

  const dispatch = useAppDispatch()

  const driverFilterId = query?.filters?.driver_id?.value
  const rejectedSelected = splitRejectedStatus(query).includesRejected

  const countShipments = () => {
    return `(${trips.length + rejectedTrips.length})`
  }

  useEffect(() => {
    dispatch(fetchTrips(debouncedQuery) as any)
  }, [dispatch, debouncedQuery])

  useEffect(() => {
    let canceled = false
    async function loadRejected() {
      const driverIdRaw = debouncedQuery?.filters?.driver_id?.value
      const hasDriver = driverIdRaw != null && driverIdRaw !== ''
      const wantsRejected = splitRejectedStatus(debouncedQuery).includesRejected
      if (!hasDriver && !wantsRejected) {
        setRejectedTrips([])
        return
      }
      try {
        // No driverId ⇒ every rejected snapshot in the tenant, which is what
        // picking "Rejected" with no driver means.
        const rows = await API.fetchRejectedTrips(
          hasDriver ? { driverId: Number(driverIdRaw) } : {},
        )
        if (!canceled) setRejectedTrips(Array.isArray(rows) ? rows : [])
      } catch {
        if (!canceled) setRejectedTrips([])
      }
    }
    loadRejected()
    return () => {
      canceled = true
    }
  }, [debouncedQuery])

  const allTrips = driverFilterId != null || rejectedSelected ? [...rejectedTrips, ...trips] : trips

  return (
    <Lane key="Trips" title={`Trips ${countShipments()}`}>
      <Link to="/planning" className={styles.newTripButton}>
        <Button>New Trip</Button>
      </Link>
      <div className={styles['trip-container']}>
        <div className={styles['filter-container']}>
          <TripsFilter />
        </div>
        <div className={styles['trips-card-container']}>
          {allTrips.length || loading ? (
            <MemoizedTripCards trips={allTrips} />
          ) : (
            <div className={styles['empty-dislaimer']}>
              <h3>No trips found</h3>
              Please revise your search
            </div>
          )}
        </div>
      </div>
    </Lane>
  )
}
