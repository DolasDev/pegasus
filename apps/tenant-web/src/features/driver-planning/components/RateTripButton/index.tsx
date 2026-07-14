import React, { useState } from 'react'
import { Button } from '../Button'
import { RateTripResult } from '../RateTripResult'
import { useRateTrip } from '@/api/queries/rating'
import type { RateShipmentInput } from '../../utils/rate-shipment'

interface RateTripButtonProps {
  shipments: RateShipmentInput[] | undefined | null
  className?: string
}

/**
 * "Rate trip" action — prompts for the TSP linehaul discount, then rates every
 * shipment on the trip against the active 400NG tariff and shows a per-shipment
 * + trip-total breakdown. Shared by the Planning screen (PendingTrips) and the
 * trip-detail (gantt) page.
 */
export const RateTripButton: React.FC<RateTripButtonProps> = ({ shipments, className }) => {
  const [open, setOpen] = useState(false)
  const rateTrip = useRateTrip()
  const list = shipments ?? []

  const handleOpen = (): void => {
    rateTrip.reset()
    setOpen(true)
  }

  const handleRate = (discountPercent: number): void => {
    rateTrip.mutate({ shipments: list, discountPercent })
  }

  return (
    <>
      <Button
        className={className}
        data-target="rate-trip"
        disabled={list.length === 0}
        onClick={handleOpen}
      >
        <i className="fas fa-calculator"></i> &nbsp;Rate trip
      </Button>
      <RateTripResult
        open={open}
        onClose={() => setOpen(false)}
        onRate={handleRate}
        loading={rateTrip.isPending}
        error={rateTrip.error ?? null}
        hasResult={rateTrip.isSuccess}
        rows={rateTrip.data?.rows ?? []}
        total={rateTrip.data?.total ?? 0}
        appliedDiscount={rateTrip.data?.discountPercent ?? 0}
      />
    </>
  )
}
