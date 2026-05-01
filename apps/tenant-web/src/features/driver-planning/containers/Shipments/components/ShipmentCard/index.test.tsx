import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

vi.mock('../../../../redux/shipments', () => ({
  selectShipment: (s: any) => ({ type: 'shipments/selectShipment', payload: s }),
}))
vi.mock('../../../../redux/pending-trips', () => ({
  addShipmentToTrip: (s: any) => ({ type: 'pendingTrips/addShipmentToTrip', payload: s }),
}))

import { ShipmentCard } from './index'

const baseShipment = {
  order_num: 'ORD-9',
  shipper_state: 'CA',
  shipper_city: 'LOS ANGELES',
  consignee_state: 'NY',
  consignee_city: 'NEW YORK',
  total_est_wt: 5000,
  pack_date2: '2026-04-01',
  load_date2: '2026-04-02',
  del_date2: '2026-04-03',
  plan_pack: '2026-04-01',
  plan_load: '2026-04-02',
  plan_del: '2026-04-03',
  shaul: 'L',
  haul_mode: 'long',
  driver_name: 'SMITH, JOHN',
  company: 'ACME CORP',
  ba_name: 'ACME',
  avl_reg: 'AVL',
  shipper_name: 'DOE, JANE',
  TripStatus_id: 0,
  TripMaster_id: '',
  latest_activity_abbr: 'PCK',
  latest_activity_date: '2026-04-01',
  type_packing: 'N',
  vip: 'N',
  supervip: 'N',
  rule19_id: null,
  packing_coverage: null,
  driver_id: null,
  sit_date: null,
  storage_driver_id: null,
  import_export: '',
}

describe('ShipmentCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders card with order number and shipment data', () => {
    const { getByText } = renderWithStore(
      <ShipmentCard shipment={baseShipment} tripsForShipment={[]} />,
    )
    expect(getByText(/ORD-9/)).toBeInTheDocument()
  })

  it('dispatches selectShipment when card is clicked', () => {
    const { getByText, dispatched } = renderWithStore(
      <ShipmentCard shipment={baseShipment} tripsForShipment={[]} />,
    )
    // Click any visible element in the card - the click bubbles up to the
    // Card's onClick handler.
    fireEvent.click(getByText(/ORD-9/))
    const action = dispatched.find((a) => a && a.type === 'shipments/selectShipment')
    expect(action).toBeTruthy()
    expect(action.payload.order_num).toBe('ORD-9')
  })

  it('dispatches addShipmentToTrip when + button is clicked', () => {
    const { container, dispatched } = renderWithStore(
      <ShipmentCard shipment={baseShipment} tripsForShipment={[]} />,
    )
    const button = container.querySelector('button')!
    fireEvent.click(button)
    const action = dispatched.find((a) => a && a.type === 'pendingTrips/addShipmentToTrip')
    expect(action).toBeTruthy()
  })

  it('disables + button when shipment already on a trip', () => {
    const { container } = renderWithStore(
      <ShipmentCard shipment={baseShipment} tripsForShipment={[{ id: 1 }]} />,
    )
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows VIP indicator when shipment.vip === Y', () => {
    const { getByText } = renderWithStore(
      <ShipmentCard shipment={{ ...baseShipment, vip: 'Y' }} tripsForShipment={[]} />,
    )
    expect(getByText('VIP')).toBeInTheDocument()
  })
})
