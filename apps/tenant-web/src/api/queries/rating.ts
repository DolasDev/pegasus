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
}

export function useRateTrip() {
  return useMutation<RateTripResult, Error, RateShipmentInput[]>({
    mutationFn: async (shipments) => {
      const rows = await rateTripShipments(shipments, rateShipment)
      return { rows, total: tripRateTotal(rows) }
    },
  })
}
