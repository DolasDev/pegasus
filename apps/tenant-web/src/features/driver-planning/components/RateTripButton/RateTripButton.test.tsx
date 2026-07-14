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

  it('prompts for a discount, then rates — showing rows, a total of only rated rows, and threading the discount', async () => {
    renderWithClient(<RateTripButton shipments={shipments} />)

    // Opening the dialog does not rate yet — it prompts for the discount.
    fireEvent.click(screen.getByRole('button', { name: /rate trip/i }))
    const input = document.querySelector('[data-target="rate-trip-discount"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(rateShipment).not.toHaveBeenCalled()

    // Enter a discount and run.
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(document.querySelector('[data-target="rate-trip-run"]') as HTMLElement)

    // The dialog renders through a Radix portal into document.body.
    await waitFor(() => {
      expect(document.querySelector('[data-target="rate-trip-total"]')).not.toBeNull()
    })

    // One row per shipment, in order.
    const rows = document.querySelectorAll('[data-target="rate-row"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].getAttribute('data-status')).toBe('rated')
    expect(rows[1].getAttribute('data-status')).toBe('uncable')
    expect(rows[2].getAttribute('data-status')).toBe('error')
    expect(rows[0].textContent).toContain('$2,500')

    // Only the two rateable-looking shipments hit the API, each with the discount.
    expect(rateShipment).toHaveBeenCalledTimes(2)
    expect(rateShipment).toHaveBeenCalledWith(
      expect.objectContaining({ linehaulDiscountPercent: 15 }),
    )

    // Trip total sums only the single rated row; footer notes the two not rated.
    expect(document.querySelector('[data-target="rate-trip-total"]')?.textContent).toContain(
      '$2,500',
    )
    expect(document.querySelector('[data-target="rate-trip-total-row"]')?.textContent).toMatch(
      /2 not rated/,
    )
    // The applied-discount note reflects the entered value.
    expect(
      document.querySelector('[data-target="rate-trip-applied-discount"]')?.textContent,
    ).toMatch(/15%/)
  })

  it('blocks rating on an invalid discount', () => {
    renderWithClient(<RateTripButton shipments={shipments} />)
    fireEvent.click(screen.getByRole('button', { name: /rate trip/i }))

    const input = document.querySelector('[data-target="rate-trip-discount"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '150' } })

    expect(document.querySelector('[data-target="rate-trip-discount-error"]')).not.toBeNull()
    expect(document.querySelector('[data-target="rate-trip-run"]')).toBeDisabled()
    fireEvent.click(document.querySelector('[data-target="rate-trip-run"]') as HTMLElement)
    expect(rateShipment).not.toHaveBeenCalled()
  })
})
