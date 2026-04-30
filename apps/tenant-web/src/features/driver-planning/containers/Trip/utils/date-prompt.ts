import { useEffect, useRef, useState } from 'react'

export function promptForStatusUpdate(status: any, cb: any) {
  window.alert(`Dates have changed on one or more activities!\nPlease review and adjust itinerary`)
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
