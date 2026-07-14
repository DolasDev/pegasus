// ---------------------------------------------------------------------------
// RateTripButton tests — clicking rates every shipment, renders a per-shipment
// row, isolates a mileage error, skips an uncable shipment, and shows a trip
// total that sums only the rated rows.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RateTripButton } from './index'
import type { RateShipmentInput } from '../../utils/rate-shipment'

// Mock the single-shipment rate call the button ultimately drives.
const rateShipment = vi.fn()
vi.mock('@/api/rating', () => ({
  rateShipment: (...args: unknown[]) => rateShipment(...args),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const shipments: RateShipmentInput[] = [
  {
    order_num: 101,
    total_est_wt: 5000,
    shipper_zip: '30301',
    consignee_zip: '20001',
    plan_load: '2026-08-01',
    shipper_city: 'Atlanta',
    shipper_state: 'GA',
    consignee_city: 'Washington',
    consignee_state: 'DC',
  },
  // uncable — no origin zip
  {
    order_num: 102,
    total_est_wt: 3000,
    shipper_zip: null,
    consignee_zip: '20001',
    plan_load: '2026-08-02',
  },
  // rateable, but the API rejects it (mileage out of range)
  {
    order_num: 103,
    total_est_wt: 4000,
    shipper_zip: '30301',
    consignee_zip: '99999',
    plan_load: '2026-08-03',
  },
]

beforeEach(() => {
  rateShipment.mockReset()
  rateShipment.mockImplementation(async (payload: { destZip: string }) => {
    if (payload.destZip === '99999') {
      throw new Error('No mileage estimate available for 30301 -> 99999')
    }
    return { total: 2500, meta: { billedWeightLbs: 5000, warnings: [] } }
  })
})

describe('RateTripButton', () => {
  it('is disabled when the trip has no shipments', () => {
    renderWithClient(<RateTripButton shipments={[]} />)
    expect(screen.getByRole('button', { name: /rate trip/i })).toBeDisabled()
  })

  it('rates the trip and shows per-shipment rows + a trip total of only rated rows', async () => {
    renderWithClient(<RateTripButton shipments={shipments} />)

    fireEvent.click(screen.getByRole('button', { name: /rate trip/i }))

    // The dialog renders through a Radix portal into document.body, so query
    // the document rather than the render container.
    // Wait for the batch to settle (loading state gone, total rendered).
    await waitFor(() => {
      expect(document.querySelector('[data-target="rate-trip-total"]')).not.toBeNull()
    })

    // One row per shipment, in order.
    const rows = document.querySelectorAll('[data-target="rate-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].getAttribute('data-status')).toBe('rated')
    expect(rows[1].getAttribute('data-status')).toBe('uncable')
    expect(rows[2].getAttribute('data-status')).toBe('error')

    // The rateable shipment shows its 400NG amount; the errored/uncable rows don't.
    expect(rows[0].textContent).toContain('$2,500')

    // Only the two rateable-looking shipments hit the API; the uncable one was skipped.
    expect(rateShipment).toHaveBeenCalledTimes(2)

    // Trip total sums only the single rated row.
    const total = document.querySelector('[data-target="rate-trip-total"]')
    expect(total?.textContent).toContain('$2,500')

    // Footer notes the two shipments that weren't rated.
    const totalRow = document.querySelector('[data-target="rate-trip-total-row"]')
    expect(totalRow?.textContent).toMatch(/2 not rated/)
  })
})
