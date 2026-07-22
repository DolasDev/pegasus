import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShipmentsTable } from './index'

// The Pack/Load/Del "Range" columns render a shipment's date spread, which is
// always `*_date2` (start) → `plan_*` (end) — the same pair ShipmentDetail's
// "… Date Spread" rows and the ShipmentCard columns read. These tests pin the
// column config to those field names: a regression previously read
// `pack_date` / `load_date` / `del_date` for the range start, which are
// saved-filter query keys and not row fields, so every range rendered with a
// blank start and the start date sitting in the end slot.

// Dates are formatted with `timeZone: 'UTC'` (utils/format-date), so a bare
// YYYY-MM-DD renders as the same calendar day regardless of the runner's TZ.
const shipment = {
  order_num: 12345,
  shipper_name: 'DOE, JOHN',
  shipper_city: 'AUSTIN',
  shipper_state: 'TX',
  consignee_city: 'DENVER',
  consignee_state: 'CO',
  total_est_wt: 8200,
  pack_date2: '2026-01-05',
  plan_pack: '2026-01-07',
  load_date2: '2026-01-08',
  plan_load: '2026-01-09',
  del_date2: '2026-01-14',
  plan_del: '2026-01-16',
}

describe('ShipmentsTable date-range columns', () => {
  it('renders each range as `*_date2` - `plan_*`', () => {
    render(<ShipmentsTable shipments={[shipment]} />)
    expect(screen.getByText('01/05/26 - 01/07/26')).toBeInTheDocument()
    expect(screen.getByText('01/08/26 - 01/09/26')).toBeInTheDocument()
    expect(screen.getByText('01/14/26 - 01/16/26')).toBeInTheDocument()
  })

  it('ignores the saved-filter query keys (pack_date / load_date / del_date)', () => {
    // A row carrying those keys must not pick them up — they are filter field
    // names, and treating them as columns is what produced the blank starts.
    render(
      <ShipmentsTable
        shipments={[{ ...shipment, pack_date: '2020-01-01', load_date: '2020-01-01' }]}
      />,
    )
    expect(screen.getByText('01/05/26 - 01/07/26')).toBeInTheDocument()
    expect(screen.getByText('01/08/26 - 01/09/26')).toBeInTheDocument()
    expect(screen.queryByText(/01\/01\/20/)).not.toBeInTheDocument()
  })

  it('renders a half-open range when the plan side is missing', () => {
    const partial = { ...shipment, plan_load: null }
    render(<ShipmentsTable shipments={[partial]} />)
    expect(screen.getByText('01/08/26 -')).toBeInTheDocument()
  })

  it('sorts the range columns by their `*_date2` field', () => {
    const { container } = render(<ShipmentsTable shipments={[shipment]} onSort={() => {}} />)
    const sortKeys = Array.from(
      container.querySelectorAll('th[data-target="shipment-table-sort-header"]'),
    ).map((th) => th.getAttribute('data-sort'))
    expect(sortKeys).toEqual(expect.arrayContaining(['pack_date2', 'load_date2', 'del_date2']))
  })
})
