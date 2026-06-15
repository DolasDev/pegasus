import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { TripService, isOfferedTrip } from '../services/tripService'
import type { LonghaulTrip } from '../types/longhaul'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// Shared driver-trips state. One fetch backs the My Trips list, the dashboard
// "Offered Trips" tile, and the drawer badge so they never drift or double-
// fetch. Mounted around the drawer navigator so both the drawer content and
// the screens can consume it.
// ---------------------------------------------------------------------------

interface TripsContextValue {
  /** True while the initial mapping + trips load is in flight. */
  loading: boolean
  /** True once the /me/driver mapping call has resolved (mapped or not). */
  mappingResolved: boolean
  /** The logged-in user's longhaul driver id, or null when unmapped. */
  driverId: number | null
  /** Visible trips (excludes pending + canceled), sorted by planned start desc. */
  trips: LonghaulTrip[]
  /** Count of trips currently in the Offered status. */
  offeredCount: number
  /** Non-fatal error message from the last load, if any. */
  error: string | null
  /** Re-run the mapping + trips load. */
  refresh: () => Promise<void>
}

const TripsContext = createContext<TripsContextValue | undefined>(undefined)

export function TripsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [mappingResolved, setMappingResolved] = useState(false)
  const [driverId, setDriverId] = useState<number | null>(null)
  const [trips, setTrips] = useState<LonghaulTrip[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const id = await TripService.getDriverId()
      setDriverId(id)
      setMappingResolved(true)
      if (id == null) {
        setTrips([])
        return
      }
      const data = await TripService.getMyTrips(id)
      setTrips(data)
    } catch (err) {
      logger.warn('Failed to load driver trips', err)
      setError(err instanceof Error ? err.message : 'Failed to load trips')
      setMappingResolved(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<TripsContextValue>(
    () => ({
      loading,
      mappingResolved,
      driverId,
      trips,
      offeredCount: trips.filter(isOfferedTrip).length,
      error,
      refresh,
    }),
    [loading, mappingResolved, driverId, trips, error, refresh],
  )

  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>
}

export function useTrips(): TripsContextValue {
  const ctx = useContext(TripsContext)
  if (!ctx) throw new Error('useTrips must be used within a TripsProvider')
  return ctx
}
