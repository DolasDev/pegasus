// ---------------------------------------------------------------------------
// ActivitiesModule (Services) smoke test: composition only, same shape as
// PlanningModule.test.tsx. Children are mocked; this pins that the board and
// the shipment detail panel are both mounted.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../containers/Activities', () => ({
  ActivitiesDashboard: () => <div data-testid="mock-activities-dashboard" />,
}))
vi.mock('../containers/ShipmentDetail', () => ({
  ShipmentDetail: () => <div data-testid="mock-shipment-detail" />,
}))

import { ActivitiesModule } from './ActivitiesModule'

describe('ActivitiesModule', () => {
  it('mounts the board alongside the shipment detail panel', () => {
    render(<ActivitiesModule />)

    expect(screen.getByTestId('mock-activities-dashboard')).toBeInTheDocument()
    // Selecting a service card sets `shipments.selectedShipment`, which this
    // panel reads, the same as a shipment card on Planning.
    expect(screen.getByTestId('mock-shipment-detail')).toBeInTheDocument()
  })
})
