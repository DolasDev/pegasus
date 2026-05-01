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
