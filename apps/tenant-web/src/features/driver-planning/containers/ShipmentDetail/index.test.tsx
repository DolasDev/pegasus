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

// Trip sheet: the pegII order-profile report. The fetch and the blob/window
// plumbing are unit-tested in their own modules; here we only care that the
// pane wires them together and degrades legibly.
const { fetchPegiiReportMock, openBase64DocumentMock, notifyErrorMock } = vi.hoisted(() => ({
  fetchPegiiReportMock: vi.fn(),
  openBase64DocumentMock: vi.fn(() => true),
  notifyErrorMock: vi.fn(),
}))
vi.mock('@/api/queries/pegii-reports', () => ({ fetchPegiiReport: fetchPegiiReportMock }))
vi.mock('@/lib/open-base64-pdf', () => ({ openBase64Document: openBase64DocumentMock }))
// Partial mock: the real module also exports registerSnackbarPush, which the
// <SnackbarProvider> inside renderWithStore calls on mount.
vi.mock('../../components/Snackbar/notify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifyError: notifyErrorMock,
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
import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'

// Typed, so a fixture cannot drift onto a field the view does not project —
// the same protection the component now has. `satisfies` keeps the literal's
// narrow types for the assertions below.
const happyShipment = {
  order_num: '12345',
  shipper_name: 'ACME Shipper',
  shipper_add1: '99 Congress Ave',
  shipper_add2: 'Floor 2',
  shipper_city: 'Austin',
  shipper_state: 'TX',
  shipper_zip: '78701',
  // Destination street: the view's consignee_name1/2 (aliased
  // destination_address1/2 by the legacy entity). `del_address1` is the
  // unrelated extra-delivery address and must never reach the street line.
  consignee_name1: '123 Main',
  consignee_name2: 'Suite 4',
  del_address1: '900 Extra Stop Rd',
  consignee_city: 'Denver',
  consignee_state: 'CO',
  consignee_zip: '80202',
  ba_name: 'Big Account',
  booker_name: 'Boo Booker',
  haul_name: 'Hauler Inc',
  avl_reg: 'REG-001',
  move_desc: 'COD',
  coordinator: 'Coord Name',
  // The operations person: `salesman.last_name`, projected by the view under
  // its own name. `OpsLastName` was a legacy entity alias, never a column.
  last_name: 'Opsington',
  oa_id: 'OA1',
  oa_name: 'Origin Agent',
  da_id: 'DA1',
  da_name: 'Dest Agent',
  pegasus_shadow: {
    weight: 50,
    lng_dis_comments: 'hello @Sam there',
    operations_name: null as string | null,
  },
} satisfies LonghaulShipmentRow

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

  it('renders the operations person from last_name, falling back to the shadow name', () => {
    // Regression: the accessor read `OpsLastName` — a legacy entity property
    // aliased onto salesman.last_name, not a column on the view — so the row
    // was blank on every order.
    const { unmount } = renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: happyShipment } as any,
      user: { user: sampleUser } as any,
    })
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Opsington')).toBeInTheDocument()
    unmount()

    // No salesman row matched operations_id → fall back to the shadow's own
    // operations_name rather than rendering blank.
    const noSalesman = { ...happyShipment, last_name: null }
    noSalesman.pegasus_shadow = { ...happyShipment.pegasus_shadow, operations_name: 'Shadow Ops' }
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: noSalesman } as any,
      user: { user: sampleUser } as any,
    })
    expect(screen.getByText('Shadow Ops')).toBeInTheDocument()
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
    // Regression: the street line read del_address1/2 — the extra-delivery
    // address — so it was blank on every order without an extra delivery and
    // showed the extra stop on the orders that had one.
    expect(screen.queryByText(/900 Extra Stop Rd/)).not.toBeInTheDocument()
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
      'consignee_name1',
      'consignee_name2',
      'del_address1',
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

  it('renders O/A and D/A from their fields, and degrades to blank when absent', () => {
    // Present: the row shows "id - name".
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: happyShipment } as any,
      user: { user: sampleUser } as any,
    })
    expect(screen.getByText('OA1 - Origin Agent')).toBeInTheDocument()
    expect(screen.getByText('DA1 - Dest Agent')).toBeInTheDocument()
  })

  it('never renders "undefined" for O/A, D/A, or the extra-stops row when absent', () => {
    // Regression: these accessors interpolated oa_id/oa_name, da_id/da_name and
    // extrapu/extradel straight into a template literal, so a shipment without
    // them printed "undefined - undefined" to the user.
    const noAgents = { ...happyShipment }
    for (const k of ['oa_id', 'oa_name', 'da_id', 'da_name', 'extrapu', 'extradel']) {
      delete (noAgents as any)[k]
    }
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: noAgents } as any,
      user: { user: sampleUser } as any,
    })
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
    // O/A and D/A labels still render, just with an empty value.
    expect(screen.getByText('O/A')).toBeInTheDocument()
    expect(screen.getByText('D/A')).toBeInTheDocument()
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

  describe('reg number → Atlas web dispatch link', () => {
    it('links the reg number to Atlas with an "open in Atlas" tooltip', () => {
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: { ...happyShipment, avl_reg: 'RC086240' } } as any,
        user: { user: sampleUser } as any,
      })
      const link = document.querySelector('[data-target="atlas-reg-link"]') as HTMLAnchorElement
      expect(link).not.toBeNull()
      expect(link.tagName.toLowerCase()).toBe('a')
      expect(link.textContent).toBe('RC086240')
      expect(link.getAttribute('href')).toBe(
        'https://atlasnet.atlasworldgroup.com/webdispatch/editshipment/RC086240',
      )
      expect(link.getAttribute('title')).toBe('open in Atlas')
      // Opens Atlas in its own tab without handing it window.opener.
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    })

    it('looks like the Order Number link above it (shared Clickable styling)', () => {
      // Tailwind preflight resets bare anchors to `color: inherit;
      // text-decoration: inherit`, so without an explicit class this renders as
      // plain body text instead of a blue underlined link. It must carry the
      // same class the Order Number Clickable uses, one row above.
      isJumpToOrderEnabledMock.mockReturnValue(true)
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: { ...happyShipment, avl_reg: 'RC086240' } } as any,
        user: { user: sampleUser } as any,
      })
      const link = document.querySelector('[data-target="atlas-reg-link"]') as HTMLAnchorElement
      const orderNumber = screen.getByText('12345')
      const sharedClass = orderNumber.className.split(/\s+/)[0]
      expect(sharedClass).toBeTruthy()
      expect(link.className.split(/\s+/)).toContain(sharedClass)
    })

    it('renders no link (and no ".../undefined" href) when the reg number is absent', () => {
      const noReg = { ...happyShipment }
      delete (noReg as any).avl_reg
      renderWithStore(<ShipmentDetail />, {
        shipments: { selectedShipment: noReg } as any,
        user: { user: sampleUser } as any,
      })
      expect(document.querySelector('[data-target="atlas-reg-link"]')).toBeNull()
      expect(document.querySelector('a[href*="editshipment"]')).toBeNull()
      // The row itself still renders its label, just with an empty value.
      expect(screen.getByText('Reg Number')).toBeInTheDocument()
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

describe('ShipmentDetail — View Trip Sheet', () => {
  const REPORT = {
    reportType: 'order-profile',
    id: '12345',
    fileName: 'OrderProfile_12345.pdf',
    contentType: 'application/pdf',
    contentBase64: 'JVBERi0=',
  }

  const renderPane = (shipment: unknown = happyShipment) =>
    renderWithStore(<ShipmentDetail />, {
      shipments: { selectedShipment: shipment } as any,
      user: { user: sampleUser } as any,
    })

  const link = () => document.querySelector('[data-target="trip-sheet-link"]') as HTMLButtonElement

  beforeEach(() => {
    vi.clearAllMocks()
    fetchPegiiReportMock.mockResolvedValue(REPORT)
    openBase64DocumentMock.mockReturnValue(true)
  })

  it('renders the link for a shipment with an order number', () => {
    renderPane()
    expect(screen.getByText('Trip Sheet')).toBeInTheDocument()
    expect(link()).not.toBeNull()
    expect(link().textContent).toBe('View Trip Sheet')
  })

  it('fetches the order-profile report for the row and opens it', async () => {
    renderPane()
    fireEvent.click(link())

    await waitFor(() => expect(openBase64DocumentMock).toHaveBeenCalled())
    expect(fetchPegiiReportMock).toHaveBeenCalledWith('order-profile', '12345')
    expect(openBase64DocumentMock).toHaveBeenCalledWith({
      contentBase64: REPORT.contentBase64,
      contentType: REPORT.contentType,
    })
    expect(notifyErrorMock).not.toHaveBeenCalled()
  })

  it('does not fetch on render — only on click', () => {
    renderPane()
    expect(fetchPegiiReportMock).not.toHaveBeenCalled()
  })

  it('disables the link while the report is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    fetchPegiiReportMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    renderPane()
    fireEvent.click(link())

    await waitFor(() => expect(link().disabled).toBe(true))
    expect(link().textContent).toBe('Loading…')

    release(REPORT)
    await waitFor(() => expect(link().disabled).toBe(false))
  })

  it('surfaces the API error message rather than error-boundarying the pane', async () => {
    fetchPegiiReportMock.mockRejectedValue(new Error('pegII order source is not configured'))

    renderPane()
    fireEvent.click(link())

    await waitFor(() =>
      expect(notifyErrorMock).toHaveBeenCalledWith('pegII order source is not configured'),
    )
    // The pane survives and the link is usable again.
    expect(link().disabled).toBe(false)
    expect(screen.getByText('Shipper Name')).toBeInTheDocument()
  })

  it('tells the user when the browser blocked the popup', async () => {
    openBase64DocumentMock.mockReturnValue(false)

    renderPane()
    fireEvent.click(link())

    await waitFor(() =>
      expect(notifyErrorMock).toHaveBeenCalledWith(expect.stringMatching(/pop-ups/)),
    )
  })

  it('renders no link when the row has no order number', () => {
    const noOrder = { ...happyShipment, order_num: null }
    renderPane(noOrder)

    expect(link()).toBeNull()
    // The row keeps its label, like the Reg Number row does when avl_reg is absent.
    expect(screen.getByText('Trip Sheet')).toBeInTheDocument()
  })
})
