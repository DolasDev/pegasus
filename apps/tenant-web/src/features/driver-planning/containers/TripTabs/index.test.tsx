import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('../../utils/api', () => ({
  API: {},
}))

import { renderWithStore } from '../../__test-utils__/render-with-store'
import { TripTabs } from './index'

describe('TripTabs', () => {
  it('renders a tab for each trip in the planning slice', () => {
    renderWithStore(<TripTabs />, {
      preloadedState: {
        tripPlanning: {
          trips: [{ name: 'Tab A' }, { name: 'Tab B' }],
          selectedTripIndex: 0,
        } as any,
      },
    })
    expect(screen.getByText('Tab A')).toBeInTheDocument()
    expect(screen.getByText('Tab B')).toBeInTheDocument()
  })

  it('renders a "+" button for adding a new trip', () => {
    renderWithStore(<TripTabs />, {
      preloadedState: {
        tripPlanning: { trips: [{ name: 'X' }], selectedTripIndex: 0 } as any,
      },
    })
    expect(screen.getByText('+')).toBeInTheDocument()
  })

  it('clicking a non-selected tab does not throw and renders the tabs', () => {
    renderWithStore(<TripTabs />, {
      preloadedState: {
        tripPlanning: {
          trips: [{ name: 'Tab A' }, { name: 'Tab B' }],
          selectedTripIndex: 0,
        } as any,
      },
    })
    fireEvent.click(screen.getByText('Tab B'))
    // Both tabs still rendered after click
    expect(screen.getByText('Tab A')).toBeInTheDocument()
    expect(screen.getByText('Tab B')).toBeInTheDocument()
  })
})
