import { useEffect, useRef, useState } from 'react'
import { notify } from '../../../components/Snackbar/notify'

export function promptForStatusUpdate(_status: any, _cb: any) {
  notify(`Dates have changed on one or more activities! Please review and adjust itinerary`, {
    type: 'error',
  })
}

export const useDateChangePrompt = ({ trip, hasDateChange, updateActivityDates }: any) => {
  const [showPrompt, setShowPrompt] = useState(true)
  const latestTripId = useRef(trip?.id)

  useEffect(() => {
    if (trip) {
      setShowPrompt(false)
    }
  }, [trip])

  useEffect(() => {
    if (trip?.id === latestTripId.current) {
      // Already ran for this trip
    } else if (showPrompt) {
      latestTripId.current = trip?.id
      if (hasDateChange) {
        promptForStatusUpdate('', updateActivityDates)
      }
    }
  }, [hasDateChange, showPrompt, trip])
}
