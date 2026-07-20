import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('../../../utils/api', () => ({
  API: { fetchStates: vi.fn(async () => []), fetchDrivers: vi.fn(async () => []) },
}))

import { renderWithStore } from '../../../__test-utils__/render-with-store'
import { TripsFilter } from './TripsFilter'

describe('TripsFilter', () => {
  it('renders the Filters header', () => {
    renderWithStore(<TripsFilter />, {
      preloadedState: {
        trips: { query: { filters: {} } } as any,
      },
    })
    expect(screen.getByText(/Filters/)).toBeInTheDocument()
  })

  it('renders all field labels', () => {
    renderWithStore(<TripsFilter />, {
      preloadedState: { trips: { query: { filters: {} } } as any },
    })
    // a sample of expected labels
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Trip Id')).toBeInTheDocument()
    expect(screen.getByText('Driver')).toBeInTheDocument()
    expect(screen.getByText('Origin St')).toBeInTheDocument()
    expect(screen.getByText('Active Dates')).toBeInTheDocument()
  })

  it('shows the active filter count and a Clear link when filters are set', () => {
    renderWithStore(<TripsFilter />, {
      preloadedState: {
        trips: { query: { filters: { id: '42', planner_id: ['x'] } } } as any,
      },
    })
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument()
    expect(screen.getByText('Clear')).toBeInTheDocument()
  })

  it('clicking Clear dispatches filters reset (no Clear link visible after)', () => {
    const { store } = renderWithStore(<TripsFilter />, {
      preloadedState: {
        trips: { query: { filters: { id: '42' } } } as any,
      },
    })
    const link = screen.getByText('Clear')
    fireEvent.click(link)
    expect((store.getState() as any).trips.query.filters).toEqual({})
  })

  it('maps a picked driver to the filter value via driver_id (not id)', () => {
    // Regression: DriverTypeahead options carry the raw driver row as `value`,
    // whose id column is `driver_id`. The onChange previously read `value.id`
    // (undefined), so the dispatched filter was `{ value: undefined }` and the
    // API dropped the driver predicate — every trip came back.
    const { store } = renderWithStore(<TripsFilter />, {
      trips: { query: { filters: {} } } as any,
      common: { driversList: [{ driver_id: 12, driver_name: 'BOB JONES' }] } as any,
    })

    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    // Downshift v9 opens the menu on ArrowDown without altering the filter.
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.click(screen.getByText('Bob Jones'))

    expect((store.getState() as any).trips.query.filters.driver_id).toEqual({
      value: 12,
      label: 'Bob Jones',
    })
  })

  it('renders the Trip Id text input and accepts user typing', () => {
    renderWithStore(<TripsFilter />, {
      preloadedState: { trips: { query: { filters: {} } } as any },
    })
    // The default-case InputField for `id` is rendered with placeholder=property
    // Find a text input that exists; verify fireEvent does not throw
    const textInputs = Array.from(
      document.querySelectorAll('input[type="text"]'),
    ) as HTMLInputElement[]
    expect(textInputs.length).toBeGreaterThan(0)
    // Just ensure firing change on the input is harmless (no exception)
    fireEvent.change(textInputs[0], { target: { value: '42' } })
  })
})
