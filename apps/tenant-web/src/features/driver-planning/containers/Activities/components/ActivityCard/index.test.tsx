import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityCard, type ActivityRow } from './index'

function makeActivity(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 1,
    order_num: 5001,
    TripMaster_id: 77,
    ActivityType_code: 'PACK',
    estimated_date: '2026-09-14',
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
})
