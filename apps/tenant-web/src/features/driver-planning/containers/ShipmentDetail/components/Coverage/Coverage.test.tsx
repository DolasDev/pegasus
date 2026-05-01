import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { renderWithStore } from '../../../../__test-utils__/render-with-store'

vi.mock('../../../../utils/api', () => ({
  API: {
    saveShipmentCoverage: vi.fn(() => Promise.resolve()),
    patchShipmentShadow: vi.fn(() => Promise.resolve()),
  },
}))

import { ShipmentCoverage } from './index'
import { API } from '../../../../utils/api'

const sampleShipment = {
  order_num: '12345',
  oa_id: 'OA1',
  oa_name: 'Origin Agent',
  packing_coverage: {
    id: 'cov-1',
    note: 'covered note',
    is_covered: true,
    created_by_id: 'creator',
    updated_by_id: null,
  },
  pegasus_shadow: { weight: 0, lng_dis_comments: '' },
}

const sampleUser = {
  code: 'U1',
  updated_by_id: 'U1',
  first_name: 'Sam',
}

describe('ShipmentCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    const onUpdate = vi.fn()
    renderWithStore(<ShipmentCoverage onUpdate={onUpdate} />, {
      preloadedState: {
        shipments: { selectedShipment: sampleShipment } as any,
        user: { user: sampleUser } as any,
      },
    })
    // Edit popover starts hidden
    expect(screen.queryByText('save')).not.toBeInTheDocument()
  })

  it('toggles edit mode and shows the save button', () => {
    const onUpdate = vi.fn()
    const { container } = renderWithStore(<ShipmentCoverage onUpdate={onUpdate} />, {
      preloadedState: {
        shipments: { selectedShipment: sampleShipment } as any,
        user: { user: sampleUser } as any,
      },
    })

    const buttons = container.querySelectorAll('button')
    // First button is the agent-shield icon button.
    fireEvent.click(buttons[0])
    expect(screen.getByText('save')).toBeInTheDocument()
  })

  it('dispatches saveShipmentCoverage and calls onUpdate when save is clicked', () => {
    const onUpdate = vi.fn()
    const { container } = renderWithStore(<ShipmentCoverage onUpdate={onUpdate} />, {
      preloadedState: {
        shipments: { selectedShipment: sampleShipment } as any,
        user: { user: sampleUser } as any,
      },
    })

    fireEvent.click(container.querySelectorAll('button')[0])
    fireEvent.click(screen.getByText('save'))

    expect(API.saveShipmentCoverage).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('renders the YesNo toggle and updates coverage state when No is clicked', () => {
    const onUpdate = vi.fn()
    const { container } = renderWithStore(<ShipmentCoverage onUpdate={onUpdate} />, {
      preloadedState: {
        shipments: { selectedShipment: sampleShipment } as any,
        user: { user: sampleUser } as any,
      },
    })

    fireEvent.click(container.querySelectorAll('button')[0])
    // After opening the popover the toggle buttons appear. Click the "No" toggle.
    fireEvent.click(screen.getByText('No'))
    fireEvent.click(screen.getByText('save'))

    expect(API.saveShipmentCoverage).toHaveBeenCalledTimes(1)
    const payload = (API.saveShipmentCoverage as any).mock.calls[0][0]
    expect(payload.is_covered).toBe(false)
    expect(payload.order_num).toBe('12345')
    expect(payload.coverage_agent_id).toBe('OA1')
  })

  it('handles a null packing_coverage and falls back to user.code as creator', () => {
    const onUpdate = vi.fn()
    const ship = { ...sampleShipment, packing_coverage: null }
    const { container } = renderWithStore(<ShipmentCoverage onUpdate={onUpdate} />, {
      preloadedState: {
        shipments: { selectedShipment: ship } as any,
        user: { user: sampleUser } as any,
      },
    })

    fireEvent.click(container.querySelectorAll('button')[0])
    fireEvent.click(screen.getByText('save'))

    const payload = (API.saveShipmentCoverage as any).mock.calls[0][0]
    expect(payload.created_by_id).toBe('U1')
    expect(payload.is_covered).toBeNull()
  })

  it('closes edit mode when the close icon is clicked', () => {
    const onUpdate = vi.fn()
    const { container } = renderWithStore(<ShipmentCoverage onUpdate={onUpdate} />, {
      preloadedState: {
        shipments: { selectedShipment: sampleShipment } as any,
        user: { user: sampleUser } as any,
      },
    })

    fireEvent.click(container.querySelectorAll('button')[0])
    expect(screen.getByText('save')).toBeInTheDocument()

    // The last button inside the popover is the close icon.
    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[buttons.length - 1])
    expect(screen.queryByText('save')).not.toBeInTheDocument()
  })
})
