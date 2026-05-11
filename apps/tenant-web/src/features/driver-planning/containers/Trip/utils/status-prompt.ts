import { useCallback, useEffect, useRef, useState } from 'react'
import { TripStatus, TripStatusOptions } from '../../../common/trip-status'
import { useConfirm } from '../../../components/ConfirmDialog'

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

/**
 * Hook returning a function that prompts the user to promote a trip status,
 * then invokes the supplied callback if they confirm. Uses the app-level
 * <ConfirmDialog> rather than `window.confirm`.
 */
export function usePromptForStatusUpdate() {
  const confirm = useConfirm()
  return useCallback(
    async (status: TripStatus, cb: () => void) => {
      const ok = await confirm({
        title: 'Promote trip status?',
        description: `Do you want to promote this trip to ${status}?`,
        confirmLabel: 'Promote',
      })
      if (ok) cb()
    },
    [confirm],
  )
}

export const useStatusPredictionPrompt = ({ trip, changeStatus }: any) => {
  const [showPrompt, setShowPrompt] = useState(false)
  const latestTripId = useRef(trip?.id)
  const promptForStatusUpdate = usePromptForStatusUpdate()

  useEffect(() => {
    if (trip) {
      setShowPrompt(true)
    }
  }, [trip])

  useEffect(() => {
    if (trip?.id === latestTripId.current || !trip?.status) {
      // Already ran for this trip
      return
    }
    if (!showPrompt) return
    latestTripId.current = trip?.id
    const calculatedStatus = predictCurrentStatus({
      status: trip?.status?.status,
      plannedFirst: new Date(trip?.planned_first_day),
      plannedEnd: new Date(trip?.planned_last_day),
    })
    if (!calculatedStatus) return
    const status = TripStatusOptions.find((option) => option.status === calculatedStatus)
    promptForStatusUpdate(calculatedStatus as TripStatus, () =>
      changeStatus(status?.status_id, status?.status),
    )
  }, [changeStatus, showPrompt, trip, promptForStatusUpdate])
}
