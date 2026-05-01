import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderWithStore } from '../../__test-utils__/render-with-store'
import { ShipmentsTable } from './index'

const sample = [
  {
    order_num: 'ORD-1',
    shipper_name: 'DOE, JANE',
    shipper_city: 'LOS ANGELES',
    shipper_state: 'CA',
    consignee_city: 'NEW YORK',
    consignee_state: 'NY',
    total_est_wt: 1000,
    pack_date: '2026-04-01',
    pack_date2: '2026-04-02',
    load_date: '2026-04-03',
    load_date2: '2026-04-04',
    del_date: '2026-04-05',
    del_date2: '2026-04-06',
  },
]

describe('ShipmentsTable', () => {
  it('renders headers', () => {
    const { getByText } = renderWithStore(<ShipmentsTable shipments={[]} />)
    expect(getByText('Shipper')).toBeInTheDocument()
    expect(getByText('Origin City')).toBeInTheDocument()
    expect(getByText('Pack Range')).toBeInTheDocument()
  })

  it('renders shipment rows when shipments are provided', () => {
    const { container } = renderWithStore(<ShipmentsTable shipments={sample} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(1)
  })

  it('renders empty body when no shipments', () => {
    const { container } = renderWithStore(<ShipmentsTable shipments={[]} />)
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(0)
  })
})
