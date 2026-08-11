import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('../../../../utils/api', () => ({
  API: {
    updateActivity: vi.fn(async () => ({})),
  },
}))

import { renderWithStore } from '../../../../__test-utils__/render-with-store'
import { ActivityGantt } from './ActivityGantt'
import { parseActivities } from '../../utils/parse-activities'

const days = ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']

const baseActivity = (overrides: any = {}) => ({
  activityId: 1,
  TripMaster_id: 100,
  order_num: 'O1',
  state: 'TX',
  planned_start: '2024-01-01T00:00:00Z',
  planned_end: '2024-01-02T00:00:00Z',
  estimated_date: null,
  actual_date: null,
  is_committed: false,
  is_confirmed: false,
  hasDateChange: false,
  activityType: { abbreviation: 'PK', code: 'PACK', isHasETA: true },
  shipment: { total_est_wt: 5000, pegasus_shadow: null },
  ...overrides,
})

describe('ActivityGantt', () => {
  it('renders day headers for each provided day', () => {
    const { container } = renderWithStore(
      <ActivityGantt days={days} activities={[]} orderIdToColor={{}} reloadTrip={() => {}} />,
    )
    const headers = container.querySelectorAll('h5')
    expect(headers.length).toBe(days.length)
  })

  it('renders an "Unknown" header for null days', () => {
    renderWithStore(
      <ActivityGantt days={[null]} activities={[]} orderIdToColor={{}} reloadTrip={() => {}} />,
    )
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('renders each activity (abbreviation + state) in the chart', () => {
    const activities = [
      baseActivity({ activityId: 1, state: 'TX', order_num: 'O1' }),
      baseActivity({
        activityId: 2,
        state: 'CA',
        order_num: 'O2',
        activityType: { abbreviation: 'DL', code: 'DELIVERY' },
      }),
    ]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1', O2: 'c2' }}
        reloadTrip={() => {}}
      />,
    )
    expect(screen.getByText('TX')).toBeInTheDocument()
    expect(screen.getByText('CA')).toBeInTheDocument()
    // Abbreviations appear with weight
    const matches = screen.getAllByText(/PK|DL/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('opens a popover when an activity is clicked (no hasDateChange)', () => {
    const activities = [baseActivity()]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1' }}
        reloadTrip={() => {}}
      />,
    )
    // The activity row contains a div with a class that includes 'activity'.
    // Click the inner content (state text) to bubble up.
    fireEvent.click(screen.getByText('TX'))
    expect(screen.getByText('save')).toBeInTheDocument()
    expect(screen.getByText('close')).toBeInTheDocument()
  })

  it('shows "Update Itinerary Dates" when activity hasDateChange is set', () => {
    const activities = [
      baseActivity({
        hasDateChange: true,
        newStart: '2024-01-03T00:00:00Z',
        newEnd: '2024-01-04T00:00:00Z',
      }),
    ]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1' }}
        reloadTrip={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('TX'))
    expect(screen.getByText('Update Itinerary Dates')).toBeInTheDocument()
  })

  it('renders one data-target row per activity with its id/order/abbr hooks', () => {
    const activities = [
      baseActivity({ activityId: 1, order_num: 'O1' }),
      baseActivity({ activityId: 2, order_num: 'O2' }),
    ]
    const { container } = renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1', O2: 'c2' }}
        reloadTrip={() => {}}
      />,
    )
    const rows = container.querySelectorAll('[data-target="gantt-activity-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-activity-id', '1')
    expect(rows[0]).toHaveAttribute('data-order-num', 'O1')
    expect(rows[0]).toHaveAttribute('data-activity-abbr', 'PK')
  })

  it('renders an ETA marker when the activity has an estimated date', () => {
    const activities = [baseActivity({ estimated_date: '2024-01-02T00:00:00Z' })]
    const { container } = renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1' }}
        reloadTrip={() => {}}
      />,
    )
    // The eta block carries the order's color class and the module `eta` class.
    expect(container.querySelector('[class*="eta"]')).toBeInTheDocument()
  })

  // A bar's column is resolved by looking its date up in `days`. That lookup
  // used to be an exact timestamp match, so any difference in time-of-day
  // missed and fell through to the `-1 → 0` default, parking the bar in the
  // first column. Column geometry: left = (80 + 1 + 10*2) * offset + 10.
  describe('column resolution', () => {
    const barFor = (container: HTMLElement) => {
      const row = container.querySelector('[data-target="gantt-activity-row"]')!
      return row.querySelector('[style*="left"]') as HTMLElement
    }

    it('places a bar in its own column when planned_start carries a time-of-day', () => {
      const activities = [
        baseActivity({
          planned_start: '2024-01-02T09:30:00Z',
          planned_end: '2024-01-02T17:00:00Z',
        }),
      ]
      const { container } = renderWithStore(
        <ActivityGantt
          days={days}
          activities={activities}
          orderIdToColor={{ O1: 'c1' }}
          reloadTrip={() => {}}
        />,
      )

      // Second column, not the 0-offset fallback.
      expect(barFor(container).style.left).toBe('111px')
    })

    it('still places a midnight planned_start in the first column', () => {
      const activities = [
        baseActivity({
          planned_start: '2024-01-01T00:00:00Z',
          planned_end: '2024-01-01T00:00:00Z',
        }),
      ]
      const { container } = renderWithStore(
        <ActivityGantt
          days={days}
          activities={activities}
          orderIdToColor={{ O1: 'c1' }}
          reloadTrip={() => {}}
        />,
      )

      expect(barFor(container).style.left).toBe('10px')
    })

    it('offsets the ETA marker by calendar day, not exact timestamp', () => {
      const activities = [
        baseActivity({
          planned_start: '2024-01-01T06:00:00Z',
          planned_end: '2024-01-01T06:00:00Z',
          estimated_date: '2024-01-02T14:45:00Z',
        }),
      ]
      const { container } = renderWithStore(
        <ActivityGantt
          days={days}
          activities={activities}
          orderIdToColor={{ O1: 'c1' }}
          reloadTrip={() => {}}
        />,
      )

      const eta = container.querySelector('[class*="eta"]') as HTMLElement
      // One column past the bar's own column.
      expect(eta.style.left).toBe('101px')
    })

    it('resolves a missing planned_start to the Unknown column', () => {
      const activities = [baseActivity({ planned_start: '', planned_end: '' })]
      const { container } = renderWithStore(
        <ActivityGantt
          days={['2024-01-01T00:00:00.000Z', null]}
          activities={activities}
          orderIdToColor={{ O1: 'c1' }}
          reloadTrip={() => {}}
        />,
      )

      expect(barFor(container).style.left).toBe('111px')
    })
  })

  it('renders the orange "New Dates!" overlay bar for a date-changed activity', () => {
    const activities = [
      baseActivity({
        hasDateChange: true,
        newStart: '2024-01-01T00:00:00Z',
        newEnd: '2024-01-02T00:00:00Z',
      }),
    ]
    renderWithStore(
      <ActivityGantt
        days={days}
        activities={activities}
        orderIdToColor={{ O1: 'c1' }}
        reloadTrip={() => {}}
      />,
    )
    expect(screen.getByText('New Dates!')).toBeInTheDocument()
  })

  // The reported bug, end to end: parseActivities feeds the Gantt, so pin the
  // pair rather than each half. Adding a planned date pushes the SHIPMENT row's
  // dates — with the shipment's time-of-day — alongside the activity's own,
  // which used to render as a second column showing the same date.
  describe('adding a planned date (regression)', () => {
    const trippedActivity = (overrides: any = {}) =>
      baseActivity({
        planned_start: '2024-01-01T00:00:00Z',
        planned_end: '2024-01-01T00:00:00Z',
        activityType: { abbreviation: 'PK', code: 'PACK', isHasETA: true },
        ...overrides,
      })

    const headerText = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('h5')).map((h) => h.textContent)

    it('adds no duplicate column when the pegged date is the same day', () => {
      const activities = [
        trippedActivity({
          // Planned date just added on the shipment: same day, 08:15 local to
          // the legacy row rather than midnight.
          shipment: {
            total_est_wt: 5000,
            pegasus_shadow: null,
            pack_date2: '2024-01-01T08:15:00Z',
            plan_pack: '2024-01-01T08:15:00Z',
          },
        }),
      ]
      const { days: parsedDays, sortedActivities } = parseActivities(activities, (i) => `c${i}`)
      const { container } = renderWithStore(
        <ActivityGantt
          days={parsedDays}
          activities={sortedActivities}
          orderIdToColor={{ O1: 'c1' }}
          reloadTrip={() => {}}
        />,
      )

      expect(headerText(container)).toEqual(['01/01'])
    })

    it('adds exactly one column when the pegged date moves to a new day', () => {
      const activities = [
        trippedActivity({
          shipment: {
            total_est_wt: 5000,
            pegasus_shadow: null,
            pack_date2: '2024-01-03T08:15:00Z',
            plan_pack: '2024-01-03T08:15:00Z',
          },
        }),
      ]
      const { days: parsedDays, sortedActivities } = parseActivities(activities, (i) => `c${i}`)
      const { container } = renderWithStore(
        <ActivityGantt
          days={parsedDays}
          activities={sortedActivities}
          orderIdToColor={{ O1: 'c1' }}
          reloadTrip={() => {}}
        />,
      )

      // The activity's own day plus the new pegged day — no repeats.
      expect(headerText(container)).toEqual(['01/01', '01/03'])
      expect(screen.getByText('New Dates!')).toBeInTheDocument()
    })

    it('renders one header per calendar day across activities with mixed times', () => {
      // Non-pegged activity type, so the only thing under test is that three
      // activities on two calendar days produce two columns.
      const travel = { abbreviation: 'TR', code: 'TRAVEL', isHasETA: false }
      const activities = [
        trippedActivity({
          activityId: 1,
          order_num: 'O1',
          activityType: travel,
          planned_start: '2024-01-01T00:00:00Z',
          planned_end: '2024-01-01T00:00:00Z',
        }),
        trippedActivity({
          activityId: 2,
          order_num: 'O2',
          state: 'CA',
          activityType: travel,
          planned_start: '2024-01-01T13:30:00Z',
          planned_end: '2024-01-01T13:30:00Z',
        }),
        trippedActivity({
          activityId: 3,
          order_num: 'O3',
          state: 'AZ',
          activityType: travel,
          planned_start: '2024-01-02T22:05:00Z',
          planned_end: '2024-01-02T22:05:00Z',
        }),
      ]
      const { days: parsedDays, sortedActivities } = parseActivities(activities, (i) => `c${i}`)
      const { container } = renderWithStore(
        <ActivityGantt
          days={parsedDays}
          activities={sortedActivities}
          orderIdToColor={{ O1: 'c1', O2: 'c2', O3: 'c3' }}
          reloadTrip={() => {}}
        />,
      )

      expect(headerText(container)).toEqual(['01/01', '01/02'])
    })

    // The visible label stays MM/DD by product decision, so two columns a year
    // apart are indistinguishable on screen. The full day rides along in the DOM
    // so a wrong-year row (prod has 1969/2000/2001 sentinels) is diagnosable.
    describe('the year is carried in the DOM, not the label', () => {
      const renderDays = (parsedDays: (string | null)[], activities: any[]) =>
        renderWithStore(
          <ActivityGantt
            days={parsedDays}
            activities={activities}
            orderIdToColor={{ O1: 'c1' }}
            reloadTrip={() => {}}
          />,
        ).container

      it('exposes data-day and title with the year while the label shows only MM/DD', () => {
        const container = renderDays(['2024-01-01T00:00:00.000Z'], [])
        const h5 = container.querySelector('h5')!
        expect(h5.textContent).toBe('01/01')
        expect(h5.textContent).not.toContain('2024')
        expect(h5.getAttribute('data-day')).toBe('2024-01-01')
        expect(container.querySelector('[title="2024-01-01"]')).not.toBeNull()
      })

      it('distinguishes two columns that render the same label a year apart', () => {
        // Exactly the prod shape: trip 14878 shows "01/07" twice, from
        // 2025-01-07 and 2026-01-07.
        const container = renderDays(['2025-01-07T00:00:00.000Z', '2026-01-07T00:00:00.000Z'], [])
        const h5s = Array.from(container.querySelectorAll('h5'))
        expect(h5s.map((h) => h.textContent)).toEqual(['01/07', '01/07'])
        expect(h5s.map((h) => h.getAttribute('data-day'))).toEqual(['2025-01-07', '2026-01-07'])
      })

      it('marks the Unknown column without inventing a day', () => {
        const container = renderDays([null], [])
        const h5 = container.querySelector('h5')!
        expect(h5.textContent).toBe('Unknown')
        expect(h5.getAttribute('data-day')).toBe('unknown')
      })
    })
  })
})
