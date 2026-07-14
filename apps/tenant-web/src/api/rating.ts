// ---------------------------------------------------------------------------
// Rating API client — thin wrapper over `POST /api/v1/rating/rate` (400NG).
// See apps/api/src/handlers/rating.ts for the server contract. `tariff:rate`
// is granted to the viewer baseline, so any standard operations user can call
// this.
// ---------------------------------------------------------------------------

import { apiFetch } from './client'

export interface RatePayload {
  weightLbs: number
  originZip: string
  destZip: string
  pickupDate: string
  options?: { fullPack?: boolean; fullUnpack?: boolean }
  linehaulDiscountPercent?: number
}

export interface RateLineItem {
  code: string
  description: string
  basis: string
  amount: number
  currency: string
}

export interface RateResult {
  lineItems: RateLineItem[]
  /** 400NG total in dollars (published baseline, undiscounted). */
  total: number
  currency: string
  meta: {
    tariffVersionId: string
    tariffLabel: string
    billedWeightLbs: number
    mileage: unknown
    warnings: string[]
  }
}

/** Rate a single shipment against the active 400NG tariff. */
export function rateShipment(payload: RatePayload): Promise<RateResult> {
  return apiFetch<RateResult>('/api/v1/rating/rate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
