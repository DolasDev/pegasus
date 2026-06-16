import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => (
    <a href={typeof props.to === 'string' ? props.to : ''} className={props.className}>
      {props.children}
    </a>
  ),
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

vi.mock('../../../../utils/api', () => ({
  API: {},
}))

import { renderWithStore } from '../../../../__test-utils__/render-with-store'
import { TripCard } from './index'

const baseTrip = {
  id: 99,
  trip_title: 'Title99',
  driver: { driver_name: 'Alice' },
  originState: { geo_code: 'TX' },
  destinationState: { geo_code: 'CA' },
  status: { status: 'pending' },
  internal_status: 'active',
  total_estimated_lbs: 12345,
  total_estimated_linehaul_usd: 7777,
  load_activity_count: 3,
  total_days: 4,
  planner: { first_name: 'P', last_name: 'L' },
  dispatcher: { first_name: 'D', last_name: 'I' },
  vip_count: 0,
  supervip_count: 0,
}

describe('TripCard', () => {
  it('renders trip id and title in the heading', () => {
    renderWithStore(<TripCard trip={baseTrip} />)
    expect(screen.getByText(/Title99/)).toBeInTheDocument()
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })

  it('renders origin and destination state codes', () => {
    renderWithStore(<TripCard trip={baseTrip} />)
    expect(screen.getByText('TX')).toBeInTheDocument()
    expect(screen.getByText('CA')).toBeInTheDocument()
  })

  it('renders status pill text', () => {
    renderWithStore(<TripCard trip={baseTrip} />)
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('shows "Unassigned" when no driver is set', () => {
    renderWithStore(<TripCard trip={{ ...baseTrip, driver: null }} />)
    expect(screen.getByText(/Unassigned/)).toBeInTheDocument()
  })

  it('marks canceled trips with the canceled CSS class on the link', () => {
    const { container } = renderWithStore(
      <TripCard trip={{ ...baseTrip, internal_status: 'canceled' }} />,
    )
    const link = container.querySelector('a')
    expect(link?.className).toMatch(/canceled/)
  })

  it('renders VIP icons when vip_count > 0', () => {
    const { container } = renderWithStore(
      <TripCard trip={{ ...baseTrip, vip_count: 2, supervip_count: 1 }} />,
    )
    // Three id-badge icons total
    expect(container.querySelectorAll('i.fa-id-badge').length).toBe(3)
  })

  it('badges rejected snapshots and links to the read-only rejected view', () => {
    const { container } = renderWithStore(
      <TripCard trip={{ ...baseTrip, isRejected: true, archivedTripId: 'arch-1' }} />,
    )
    expect(screen.getByText(/REJECTED/)).toBeInTheDocument()
    const link = container.querySelector('a')
    // router-compat translates /trips/* → /driver-planning/trips/*
    expect(link?.getAttribute('href')).toBe('/driver-planning/trips/rejected/arch-1')
    expect(container.querySelector('[data-rejected="true"]')).toBeTruthy()
  })

  it('links live trips to the editable trip-detail route', () => {
    const { container } = renderWithStore(<TripCard trip={baseTrip} />)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/driver-planning/trips/99')
  })
})
