import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithStore } from '../../__test-utils__/render-with-store'

vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({ pathname: '/', search: '', hash: '' }),
  useNavigate: () => () => {},
  useParams: () => ({}),
  translatePath: (p: string) => p,
}))

vi.mock('../../utils/api', () => ({
  API: {
    jumpToOrder: vi.fn(),
    patchShipmentShadow: vi.fn(() => Promise.resolve()),
    saveShipmentCoverage: vi.fn(() => Promise.resolve()),
  },
}))

// Control whether the order-number cell is an interactive launcher.
const { isJumpToOrderEnabledMock } = vi.hoisted(() => ({
  isJumpToOrderEnabledMock: vi.fn(() => false),
}))
vi.mock('../../utils/jump-to-order', () => ({
  isJumpToOrderEnabled: isJumpToOrderEnabledMock,
}))

vi.mock('./components/Coverage', () => ({
  ShipmentCoverage: () => <div data-testid="coverage-mock" />,
}))
vi.mock('./components/Weight', () => ({
  ShipmentWeight: () => <div data-testid="weight-mock" />,
}))
vi.mock('./components/DispatchNote', () => ({
  DispatchNote: () => <div data-testid="dispatch-note-mock" />,
}))

import { ShipmentDetail } from './index'
import { API } from '../../utils/api'

const happyShipment = {
  order_num: '12345',
  shipper_name: 'ACME Shipper',
  shipper_add1: '99 Congress Ave',
  shipper_add2: 'Floor 2',
  shipper_city: 'Austin',
  shipper_state: 'TX',
  shipper_zip: '78701',
  del_address1: '123 Main',
  del_address2: 'Suite 4',
  consignee_city: 'Denver',
  consignee_state: 'CO',
  consignee_zip: '80202',
  ba_name: 'Big Account',
  booker_name: 'Boo Booker',
  haul_name: 'Hauler Inc',
  avl_reg: 'REG-001',
  move_desc: 'COD',
  coordinator: 'Coord Name',
  OpsLastName: 'Operations',
  pegasus_shadow: { weight: 50, lng_dis_comments: 'hello @Sam there' },
}

const sampleUser = { code: 'U1', first_name: 'Sam' }

describe('ShipmentDetail container', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the pane hidden (data-open=false) when no shipment is selected', () => {
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: null } as any,
      user: { user: sampleUser } as any,
    })
    const pane = document.querySelector('[data-target="shipment-detail"]')
    expect(pane).not.toBeNull()
    expect(pane?.getAttribute('data-open')).toBe('false')
    // No field rows when nothing is selected.
    expect(document.querySelectorAll('[data-target="shipment-detail-field"]')).toHaveLength(0)
  })

  it('renders happy-path field labels when a shipment is selected', () => {
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: happyShipment } as any,
      user: { user: sampleUser } as any,
    })
    const pane = document.querySelector('[data-target="shipment-detail"]')
    expect(pane?.getAttribute('data-open')).toBe('true')
    expect(screen.getByText('Shipper Name')).toBeInTheDocument()
    expect(screen.getByText('ACME Shipper')).toBeInTheDocument()
    expect(screen.getByText('Order Number')).toBeInTheDocument()
    expect(screen.getByText('Account Name')).toBeInTheDocument()
    expect(screen.getByText('Long Distance Instructions')).toBeInTheDocument()
  })

  it('renders origin/destination street + city-state-zip from the real shipment keys', () => {
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: happyShipment } as any,
      user: { user: sampleUser } as any,
    })
    expect(screen.getByText('Origin Address')).toBeInTheDocument()
    expect(screen.getByText('99 Congress Ave, Floor 2')).toBeInTheDocument()
    expect(screen.getByText('Austin, TX 78701')).toBeInTheDocument()
    expect(screen.getByText('Destination Address')).toBeInTheDocument()
    expect(screen.getByText('123 Main, Suite 4')).toBeInTheDocument()
    expect(screen.getByText('Denver, CO 80202')).toBeInTheDocument()
  })

  it('never renders the literal "undefined" when address parts are missing', () => {
    // Regression: the accessors read legacy keys (origin_address1, origin_zip,
    // destination_*) that don't exist on the enriched row, so every part
    // interpolated as "undefined". Missing parts must now simply drop out.
    const noAddr = { ...happyShipment }
    for (const k of [
      'shipper_add1',
      'shipper_add2',
      'shipper_zip',
      'del_address1',
      'del_address2',
      'consignee_zip',
    ]) {
      delete (noAddr as any)[k]
    }
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: noAddr } as any,
      user: { user: sampleUser } as any,
    })
    // City + state still present → the city/state line survives without a zip
    // (no trailing ", undefined"), and the empty street rows render nothing
    // rather than "undefined, undefined".
    expect(screen.getByText('Austin, TX')).toBeInTheDocument()
    expect(screen.getByText('Denver, CO')).toBeInTheDocument()
    expect(screen.queryByText('undefined, undefined')).not.toBeInTheDocument()
    expect(screen.queryByText(/,\s*undefined/)).not.toBeInTheDocument()
  })

  it('does NOT crash when pegasus_shadow is missing entirely (sparse data)', () => {
    // The regression we hit: the on-prem bridge can omit the joined shadow
    // columns. ShipmentDetail must tolerate a missing pegasus_shadow without
    // throwing into the error boundary.
    const sparse = { ...happyShipment }
    delete (sparse as any).pegasus_shadow
    expect(() =>
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: sparse } as any,
        user: { user: sampleUser } as any,
      }),
    ).not.toThrow()
    // Long-distance row still renders its label.
    expect(screen.getByText('Long Distance Instructions')).toBeInTheDocument()
  })

  it('does NOT crash when the user slice has no user (sparse user)', () => {
    expect(() =>
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: happyShipment } as any,
        user: { user: null } as any,
      }),
    ).not.toThrow()
  })

  it('highlights @firstName mentions in the dispatch instructions text', () => {
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: happyShipment } as any,
      user: { user: sampleUser } as any,
    })
    // The accessor renders an inline <b>@sam</b> when the comments contain
    // "@sam" (case-insensitive, matched against first_name).
    const mention = screen.getByText('@sam')
    expect(mention).toBeInTheDocument()
    expect(mention.tagName.toLowerCase()).toBe('b')
  })

  describe('order-number jump-to-order gating', () => {
    it('renders a clickable that launches jumpToOrder when enabled', () => {
      isJumpToOrderEnabledMock.mockReturnValue(true)
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: happyShipment } as any,
        user: { user: sampleUser } as any,
      })
      const orderNum = screen.getByText('12345')
      fireEvent.click(orderNum)
      expect(API.jumpToOrder).toHaveBeenCalledWith({ order_num: '12345' })
    })

    it('renders plain text (no launch) when disabled', () => {
      isJumpToOrderEnabledMock.mockReturnValue(false)
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: happyShipment } as any,
        user: { user: sampleUser } as any,
      })
      const orderNum = screen.getByText('12345')
      expect(orderNum.tagName.toLowerCase()).toBe('span')
      fireEvent.click(orderNum)
      expect(API.jumpToOrder).not.toHaveBeenCalled()
    })
  })

  it('dispatches a deselect (thunk) when the close button is clicked', async () => {
    // selectShipment(null) is a thunk; we just verify the close click runs
    // through dispatch — the resulting reducer behavior is covered in the
    // redux/shipments unit tests.
    const { dispatched } = renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: happyShipment } as any,
      user: { user: sampleUser } as any,
    })
    const dispatchedBefore = dispatched.length
    const closeButton = document.querySelector('[data-target="close-shipment-detail"]')
    expect(closeButton).not.toBeNull()
    fireEvent.click(closeButton as Element)
    await waitFor(() => {
      expect(dispatched.length).toBeGreaterThan(dispatchedBefore)
    })
  })
})
