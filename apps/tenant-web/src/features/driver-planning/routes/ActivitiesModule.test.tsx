// ---------------------------------------------------------------------------
// ActivitiesModule (Services) smoke test: composition only, same shape as
// PlanningModule.test.tsx. Children are mocked; this pins that the board and
// the shipment detail panel are both mounted.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'

vi.mock('../containers/Activities', () => ({
  ActivitiesDashboard: () => <div data-testid="mock-activities-dashboard" />,
}))
vi.mock('../containers/ShipmentDetail', () => ({
  ShipmentDetail: () => <div data-testid="mock-shipment-detail" />,
}))

import { renderWithStore } from '../__test-utils__/render-with-store'
import { ActivitiesModule } from './ActivitiesModule'

describe('ActivitiesModule', () => {
  it('mounts the board alongside the shipment detail panel', () => {
    renderWithStore(<ActivitiesModule />)

    expect(screen.getByTestId('mock-activities-dashboard')).toBeInTheDocument()
    // Selecting a service card sets `shipments.selectedShipment`, which this
    // panel reads, the same as a shipment card on Planning.
    expect(screen.getByTestId('mock-shipment-detail')).toBeInTheDocument()
  })

  it('closes the drawer on the way out, so a trip link does not land with it open', () => {
    // The Trip page mounts the same drawer off the same global selection.
    const { store, unmount } = renderWithStore(<ActivitiesModule />, {
      shipments: { selectedShipment: { order_num: 5001 } as any },
    })

    unmount()

    expect(store.getState().shipments.selectedShipment).toBeNull()
  })
})
