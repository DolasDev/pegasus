import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  Link: (props: any) => (
    <a
      href={props.to}
      className={props.className}
      data-target={props['data-target']}
      onClick={props.onClick}
    >
      {props.children}
    </a>
  ),
}))

const fetchShipments = vi.fn()
vi.mock('../../../../utils/api', () => ({
  API: { fetchShipments: (...args: unknown[]) => fetchShipments(...args) },
}))

import { renderWithStore } from '../../../../__test-utils__/render-with-store'
import { ActivityCard, type ActivityRow } from './index'

// Every card reads the selected shipment and dispatches on click, so it needs
// the store even where a test only checks rendering.
const render = (ui: ReactElement) => renderWithStore(ui)

function makeActivity(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    order_num: 5001,
    TripMaster_id: 77,
    ActivityType_code: 'PACK',
    estimated_date: '2026-09-14',
    scheduled_date: '2026-09-14',
    actual_date: null,
    status: 'Scheduled',
    city: 'CHICAGO',
    state: 'IL',
    street: '1 Main St',
    activity_type_name: 'Packing',
    activity_type_abbreviation: 'PACK',
    driver_name: 'J Smith',
    shipper_name: 'ACME CORP',
    origin_city: 'CHICAGO',
    origin_state: 'IL',
    destination_city: 'DALLAS',
    destination_state: 'TX',
    haul_mode: 'N',
    dispatcher_last_name: 'Nguyen',
    total_est_wt: 4200,
    ...overrides,
  }
}

describe('ActivityCard', () => {
  it('dates a no-ETA activity by its scheduled day, not the blank estimated_date', () => {
    // PACK/LOAD are `isHasETA = 0`: estimated_date is NULL and the API's
    // scheduled_date falls back to planned_start.
    render(
      <ActivityCard
        activity={makeActivity({ estimated_date: null, scheduled_date: '2026-10-21' })}
      />,
    )

    expect(screen.getByText('10/21/26')).toBeInTheDocument()
  })

  it('renders the operational line: date, type, order, place, driver, dispatcher, status', () => {
    render(<ActivityCard activity={makeActivity()} />)

    expect(screen.getByText('09/14/26')).toBeInTheDocument()
    expect(screen.getByText('PACK')).toBeInTheDocument()
    expect(screen.getByText('5001')).toBeInTheDocument()
    expect(screen.getByText('Chicago, IL')).toBeInTheDocument()
    expect(screen.getByText('J Smith')).toBeInTheDocument()
    expect(screen.getByText('Nguyen')).toBeInTheDocument()
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
  })

  it('carries the ids the E2E suite targets', () => {
    render(<ActivityCard activity={makeActivity({ id: 42, order_num: 5002 })} />)

    const card = document.querySelector('[data-target="activity-card"]')!
    expect(card.getAttribute('data-activity-id')).toBe('42')
    expect(card.getAttribute('data-order-num')).toBe('5002')
  })

  it('title-cases SCREAMING legacy city names', () => {
    render(<ActivityCard activity={makeActivity({ city: 'SAN FRANCISCO', state: 'CA' })} />)

    expect(screen.getByText('San Francisco, CA')).toBeInTheDocument()
  })

  it('trims the trailing spaces legacy nvarchar columns carry (#628)', () => {
    render(<ActivityCard activity={makeActivity({ status: 'Scheduled   ' })} />)

    expect(screen.getByText('Scheduled')).toBeInTheDocument()
  })

  it('renders a lone state without a dangling comma', () => {
    render(<ActivityCard activity={makeActivity({ city: null, state: 'IL' })} />)

    expect(screen.getByText('IL')).toBeInTheDocument()
    expect(screen.queryByText(', IL')).not.toBeInTheDocument()
  })

  it('falls back to a dash rather than rendering "null"', () => {
    render(
      <ActivityCard
        activity={makeActivity({
          driver_name: null,
          status: null,
          city: null,
          state: null,
          dispatcher_last_name: null,
        })}
      />,
    )

    expect(screen.queryByText('null')).not.toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('falls back to the raw type code when the catalog has no abbreviation', () => {
    render(
      <ActivityCard
        activity={makeActivity({ activity_type_abbreviation: null, ActivityType_code: 'R19O' })}
      />,
    )

    expect(screen.getByText('R19O')).toBeInTheDocument()
  })

  it('marks an activity complete only on an actual date, never on free-text status', () => {
    const { rerender } = render(<ActivityCard activity={makeActivity({ actual_date: null })} />)
    const card = () => document.querySelector('[data-target="activity-card"]')!

    expect(card().className).not.toMatch(/complete/)

    // `status` is free text and varies by tenant, so it must not drive this.
    rerender(<ActivityCard activity={makeActivity({ actual_date: null, status: 'Complete' })} />)
    expect(card().className).not.toMatch(/complete/)

    rerender(<ActivityCard activity={makeActivity({ actual_date: '2026-09-15' })} />)
    expect(card().className).toMatch(/complete/)
  })

  it('shows the actual date under the estimated one when the work is done', () => {
    render(<ActivityCard activity={makeActivity({ actual_date: '2026-09-15' })} />)

    expect(screen.getByText('09/14/26')).toBeInTheDocument()
    expect(screen.getByText('09/15/26')).toBeInTheDocument()
  })

  it('labels a short-haul order and stays silent otherwise', () => {
    const { rerender } = render(<ActivityCard activity={makeActivity({ haul_mode: 'Y' })} />)
    expect(screen.getByText('Short haul')).toBeInTheDocument()

    rerender(<ActivityCard activity={makeActivity({ haul_mode: 'N' })} />)
    expect(screen.queryByText('Short haul')).not.toBeInTheDocument()
  })

  it('renders the origin → destination lane', () => {
    render(<ActivityCard activity={makeActivity()} />)

    expect(screen.getByText('Chicago, IL → Dallas, TX')).toBeInTheDocument()
  })

  it('names the trip only when the activity is on one', () => {
    const { rerender } = render(<ActivityCard activity={makeActivity({ TripMaster_id: 77 })} />)
    expect(screen.getByText('Trip 77')).toBeInTheDocument()

    rerender(<ActivityCard activity={makeActivity({ TripMaster_id: null })} />)
    expect(screen.queryByText(/^Trip /)).not.toBeInTheDocument()
  })

  it('links the trip number to the trip screen', () => {
    render(<ActivityCard activity={makeActivity({ TripMaster_id: 77 })} />)

    const link = screen.getByText('Trip 77').closest('a')!
    // The legacy `/trip/:id` path; router-compat rewrites it to
    // /driver-planning/trips/:id, same as the shipment detail panel's link.
    expect(link.getAttribute('href')).toBe('/trip/77')
    expect(link.getAttribute('data-target')).toBe('activity-trip-link')
  })

  describe('selection', () => {
    beforeEach(() => {
      fetchShipments.mockReset()
      fetchShipments.mockResolvedValue([{ order_num: 5001, shipper_name: 'ACME CORP' }])
    })

    it("opens the shipment detail panel on the activity's order", async () => {
      const { store } = render(<ActivityCard activity={makeActivity({ order_num: 5001 })} />)

      fireEvent.click(document.querySelector('[data-target="activity-card"]')!)

      await waitFor(() => expect(store.getState().shipments.selectedShipment?.order_num).toBe(5001))
      expect(fetchShipments).toHaveBeenCalledWith({ searchTerm: '5001' })
    })

    it('highlights the card whose order is the selected shipment', () => {
      renderWithStore(<ActivityCard activity={makeActivity({ order_num: 5001 })} />, {
        shipments: { selectedShipment: { order_num: 5001 } as any },
      })

      const card = document.querySelector('[data-target="activity-card"]')!
      expect(card.className).toMatch(/active/)
    })

    it('does nothing for an activity with no order', () => {
      render(<ActivityCard activity={makeActivity({ order_num: null })} />)

      fireEvent.click(document.querySelector('[data-target="activity-card"]')!)

      expect(fetchShipments).not.toHaveBeenCalled()
    })

    it('following the trip link does not also select the shipment', () => {
      render(<ActivityCard activity={makeActivity({ TripMaster_id: 77 })} />)

      fireEvent.click(screen.getByText('Trip 77'))

      expect(fetchShipments).not.toHaveBeenCalled()
    })
  })
})
