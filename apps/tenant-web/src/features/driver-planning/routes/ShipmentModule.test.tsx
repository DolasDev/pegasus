// ---------------------------------------------------------------------------
// ShipmentModule smoke test — composition only.
//
// We mock the heavy children (ShipmentsTable, FilterTabs) and let the real
// Lane component render. The module reads `shipments.shipmentList` and
// `shipments.query` from the store, so we provide a preloaded shipments slice.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'

vi.mock('../containers/ShipmentsTable', () => ({
  ShipmentsTable: ({ shipments }: { shipments: any[] }) => (
    <div data-testid="mock-shipments-table" data-count={shipments?.length ?? 0} />
  ),
}))
vi.mock('../containers/Shipments/components/FilterTabs', () => ({
  FilterTabs: () => <div data-testid="mock-filter-tabs" />,
}))

import { ShipmentModule } from './ShipmentModule'
import { renderWithStore } from '../__test-utils__/render-with-store'

describe('ShipmentModule', () => {
  it('renders the heading', () => {
    renderWithStore(<ShipmentModule />, {
      preloadedState: { shipments: { shipmentList: [], query: {} } as any },
    })
    expect(screen.getByText('Shipments Module')).toBeInTheDocument()
  })

  it('renders the FilterTabs and ShipmentsTable inside a Lane', () => {
    renderWithStore(<ShipmentModule />, {
      preloadedState: { shipments: { shipmentList: [], query: {} } as any },
    })
    expect(screen.getByTestId('mock-filter-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('mock-shipments-table')).toBeInTheDocument()
  })

  it('forwards the shipments list from store into the table', () => {
    renderWithStore(<ShipmentModule />, {
      preloadedState: {
        shipments: {
          shipmentList: [{ id: 1 }, { id: 2 }, { id: 3 }],
          query: {},
        } as any,
      },
    })
    const table = screen.getByTestId('mock-shipments-table')
    expect(table.getAttribute('data-count')).toBe('3')
  })
})
