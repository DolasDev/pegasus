// ---------------------------------------------------------------------------
// Rate-a-trip helpers — pure logic for turning the longhaul shipments on a
// trip into `POST /api/v1/rating/rate` calls (400NG) and folding the results
// into per-shipment rows + a trip total.
//
// Kept free of React / fetch so the field-mapping and error-isolation rules
// (which carry all the real edge cases) are unit-testable in isolation. The
// UI (RateTripButton / RateTripResult) and the query hook (api/queries/rating)
// are thin wrappers over `rateTripShipments`.
// ---------------------------------------------------------------------------

/** The subset of a reshaped longhaul shipment this feature reads. */
export interface RateShipmentInput {
  order_num?: number | string | null
  total_est_wt?: number | string | null
  shipper_zip?: string | number | null
  consignee_zip?: string | number | null
  plan_load?: string | Date | null
  plan_pack?: string | Date | null
  load_date2?: string | Date | null
  pack_date2?: string | Date | null
  shipper_city?: string | null
  shipper_state?: string | null
  consignee_city?: string | null
  consignee_state?: string | null
  [key: string]: unknown
}

/** Why a shipment could not be turned into a rate request. */
export type UncableReason = 'bad-origin-zip' | 'bad-dest-zip' | 'no-weight' | 'no-date'

/** Request body accepted by `POST /api/v1/rating/rate` (tariffCode defaults 400NG server-side). */
export interface RatePayload {
  weightLbs: number
  originZip: string
  destZip: string
  pickupDate: string
  /** TSP-negotiated linehaul discount (0-100). Omitted for the published baseline. */
  linehaulDiscountPercent?: number
}

export type BuildResult = { ok: true; payload: RatePayload } | { ok: false; reason: UncableReason }

/**
 * Coerce a legacy zip value to the 5-digit form the rate endpoint requires
 * (`/^\d{5}$/`). Legacy MSSQL stores these inconsistently, and numeric columns
 * strip leading zeros, so the digit count alone is ambiguous. A ZIP+4 is
 * nominally 9 digits and a main zip 5, so we pad any stripped leading zeros
 * back to that width before taking the 5-digit prefix:
 *   - "07016-1234" / "070161234" (ZIP+4 string) → "07016"
 *   - 70161234 (numeric ZIP+4, one zero stripped) → padded to "070161234" → "07016"
 *     (NOT the wrong "70161" a naive first-5 slice would give)
 *   - 7016 (numeric main zip, one zero stripped) → "07016"
 *   - null / "" / non-numeric / 1–3 digits (too short to trust) → null (uncable)
 * Returns null when it can't produce a trustworthy 5-digit zip.
 */
export function normalizeZip(z: unknown): string | null {
  const digits = String(z ?? '').replace(/\D/g, '')
  // ZIP+4 (nominally 9 digits): pad stripped leading zeros back before slicing.
  if (digits.length >= 6) return digits.padStart(9, '0').slice(0, 5)
  // 5-digit main zip, possibly with a stripped leading zero from numeric storage.
  if (digits.length === 4 || digits.length === 5) return digits.padStart(5, '0')
  // 1–3 digits (or empty) is too short to trust as a real zip.
  return null
}

/** First present, parseable date among the load/pack fields, as an ISO string. */
function pickPickupDate(shipment: RateShipmentInput): string | null {
  const candidates = [
    shipment.plan_load,
    shipment.plan_pack,
    shipment.load_date2,
    shipment.pack_date2,
  ]
  for (const c of candidates) {
    if (c == null || c === '') continue
    const d = c instanceof Date ? c : new Date(String(c))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

/**
 * Map one shipment to a rate request, or explain why it can't be rated.
 * Order of checks (weight → origin → dest → date) is stable so the reason is
 * deterministic when several fields are missing.
 */
export function buildRatePayload(shipment: RateShipmentInput): BuildResult {
  const weightLbs = Number(shipment.total_est_wt)
  if (!Number.isFinite(weightLbs) || weightLbs <= 0) return { ok: false, reason: 'no-weight' }

  const originZip = normalizeZip(shipment.shipper_zip)
  if (!originZip) return { ok: false, reason: 'bad-origin-zip' }

  const destZip = normalizeZip(shipment.consignee_zip)
  if (!destZip) return { ok: false, reason: 'bad-dest-zip' }

  const pickupDate = pickPickupDate(shipment)
  if (!pickupDate) return { ok: false, reason: 'no-date' }

  return { ok: true, payload: { weightLbs, originZip, destZip, pickupDate } }
}

/** What `rateShipment` (api/rating) resolves to — the unwrapped `data` envelope. */
export interface RateResult {
  total: number
  meta?: { billedWeightLbs?: number; warnings?: string[] }
}

export type RateFn = (payload: RatePayload) => Promise<RateResult>

/** One output row per input shipment, in the same order. */
export interface RateRow {
  shipment: RateShipmentInput
  status: 'rated' | 'uncable' | 'error'
  /** 400NG total (baseline, undiscounted) — present when status === 'rated'. */
  total?: number
  billedWeightLbs?: number
  warnings?: string[]
  /** Present when status === 'uncable'. */
  reason?: UncableReason
  /** Present when status === 'error' (e.g. MILEAGE_OUT_OF_RANGE). */
  message?: string
}

/** Human-readable text for an uncable reason, for the results table. */
export function uncableLabel(reason: UncableReason): string {
  switch (reason) {
    case 'bad-origin-zip':
      return 'Missing/invalid origin ZIP'
    case 'bad-dest-zip':
      return 'Missing/invalid destination ZIP'
    case 'no-weight':
      return 'No estimated weight'
    case 'no-date':
      return 'No load/pack date'
  }
}

/**
 * Rate every shipment on a trip, isolating failures so one bad shipment never
 * sinks the batch. Uncable shipments are skipped without an API call; the rest
 * are rated with a small concurrency cap (this account's Lambda concurrency is
 * 10, and the API Lambda invokes others synchronously). Output order matches
 * input order.
 */
export async function rateTripShipments(
  shipments: RateShipmentInput[],
  rateFn: RateFn,
  opts: { concurrency?: number; linehaulDiscountPercent?: number } = {},
): Promise<RateRow[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const discount = opts.linehaulDiscountPercent
  // 0 == baseline, same as omitting — only send a positive, finite discount.
  const applyDiscount = typeof discount === 'number' && Number.isFinite(discount) && discount > 0
  const rows: RateRow[] = new Array(shipments.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= shipments.length) return
      const shipment = shipments[i]
      const built = buildRatePayload(shipment)
      if (!built.ok) {
        rows[i] = { shipment, status: 'uncable', reason: built.reason }
        continue
      }
      const payload = applyDiscount
        ? { ...built.payload, linehaulDiscountPercent: discount }
        : built.payload
      try {
        const result = await rateFn(payload)
        rows[i] = {
          shipment,
          status: 'rated',
          total: result.total,
          billedWeightLbs: result.meta?.billedWeightLbs,
          warnings: result.meta?.warnings,
        }
      } catch (err) {
        rows[i] = {
          shipment,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, shipments.length) }, () => worker()))
  return rows
}

/** Sum of the `rated` rows' totals (uncable/error rows contribute nothing). */
export function tripRateTotal(rows: RateRow[]): number {
  return rows.reduce((sum, r) => (r.status === 'rated' && r.total ? sum + r.total : sum), 0)
}
