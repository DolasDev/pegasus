import { useEffect, useRef, useState } from 'react'
import { TripStatus, TripStatusOptions } from '../../../common/trip-status'

function predictCurrentStatus({
  status,
  plannedFirst,
  plannedEnd,
}: {
  status: TripStatus
  plannedFirst: Date
  plannedEnd: Date
}): TripStatus | boolean {
  const today = new Date()
  if (today >= plannedFirst && today <= plannedEnd && status === TripStatus.ACCEPTED) {
    return TripStatus.IN_PROGRESS
  } else if (today >= plannedEnd && status !== TripStatus.FINALIZED) {
    return TripStatus.FINALIZED
  }
  return false
}

export function promptForStatusUpdate(status: TripStatus, cb: Function) {
  const r = window.confirm(`Do you want to promote this trip to ${status}?`)
  if (r === true) {
    cb()
  }
}

export const useStatusPredictionPrompt = ({ trip, changeStatus }: any) => {
  const [showPrompt, setShowPrompt] = useState(false)
  const latestTripId = useRef(trip?.id)
  useEffect(() => {
    if (trip) {
      setShowPrompt(true)
    }
  }, [trip])

  useEffect(() => {
    if (trip?.id === latestTripId.current || !trip?.status) {
      // Already ran for this trip
    } else if (showPrompt) {
      latestTripId.current = trip?.id
      const calculatedStatus = predictCurrentStatus({
        status: trip?.status?.status,
        plannedFirst: new Date(trip?.planned_first_day),
        plannedEnd: new Date(trip?.planned_last_day),
      })
      const promptToPromoteStatus = !!calculatedStatus
      if (promptToPromoteStatus) {
        const status = TripStatusOptions.find((option) => option.status === calculatedStatus)
        promptForStatusUpdate(calculatedStatus as TripStatus, () =>
          changeStatus(status?.status_id, status?.status),
        ) // Possible bug here
      }
    }
  }, [changeStatus, showPrompt, trip])
}
