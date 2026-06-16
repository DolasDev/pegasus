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

const MemoizedTripCards = React.memo(({ trips }: { trips: any[] }) => {
  return trips.map((trip: any) => <TripCard key={trip.archivedTripId ?? trip.id} trip={trip} />)
})

export function Trips() {
  const trips = useSelector((state: RootState) => state.trips.tripList)
  const query = useSelector((state: RootState) => state.trips.query)
  const loading = useSelector((state: RootState) => state.shipments.loading)

  // Rejected-trip snapshots are stored cloud-side in Postgres, separate from the
  // MSSQL live-trip list. When the list is filtered by a driver, surface that
  // driver's rejected offers inline (badged) so they appear "in their trips".
  const [rejectedTrips, setRejectedTrips] = useState<any[]>([])

  const debouncedQuery = useDebounce(query, 300)

  const dispatch = useAppDispatch()

  const driverFilterId = query?.filters?.driver_id?.value

  const countShipments = () => {
    return `(${trips.length + rejectedTrips.length})`
  }

  useEffect(() => {
    dispatch(fetchTrips(debouncedQuery) as any)
  }, [dispatch, debouncedQuery])

  useEffect(() => {
    let cancelled = false
    async function loadRejected() {
      const driverId = debouncedQuery?.filters?.driver_id?.value
      if (driverId == null || driverId === '') {
        setRejectedTrips([])
        return
      }
      try {
        const rows = await API.fetchRejectedTrips({ driverId: Number(driverId) })
        if (!cancelled) setRejectedTrips(Array.isArray(rows) ? rows : [])
      } catch {
        if (!cancelled) setRejectedTrips([])
      }
    }
    loadRejected()
    return () => {
      cancelled = true
    }
  }, [debouncedQuery])

  const allTrips = driverFilterId != null ? [...rejectedTrips, ...trips] : trips

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
