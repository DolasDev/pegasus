// ---------------------------------------------------------------------------
// Rating query hooks. `useRateTrip` rates every shipment on a trip in one
// mutation and returns per-shipment rows plus a rolled-up trip total. Results
// are transient (rates aren't persisted), so there's no cache to invalidate.
// ---------------------------------------------------------------------------

import { useMutation } from '@tanstack/react-query'
import { rateShipment } from '@/api/rating'
import {
  rateTripShipments,
  tripRateTotal,
  type RateShipmentInput,
  type RateRow,
} from '@/features/driver-planning/utils/rate-shipment'

export interface RateTripResult {
  rows: RateRow[]
  total: number
  /** The discount that produced these rows (0 = baseline). */
  discountPercent: number
}

export interface RateTripVars {
  shipments: RateShipmentInput[]
  /** TSP linehaul discount, integer 0-100. 0 = published baseline. */
  discountPercent: number
}

export function useRateTrip() {
  return useMutation<RateTripResult, Error, RateTripVars>({
    mutationFn: async ({ shipments, discountPercent }) => {
      const rows = await rateTripShipments(shipments, rateShipment, {
        linehaulDiscountPercent: discountPercent,
      })
      return { rows, total: tripRateTotal(rows), discountPercent }
    },
  })
}
