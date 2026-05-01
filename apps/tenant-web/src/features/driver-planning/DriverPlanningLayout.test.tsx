// ---------------------------------------------------------------------------
// DriverPlanningLayout smoke tests
//
// The layout combines:
//   - Redux Provider (real store)
//   - DriverPlanningTabs nav (depends on @tanstack/react-router's Link/useRouter)
//   - AppGuard (fetches a bunch of data on mount)
//   - <Outlet />
//
// We mock the router primitives + AppGuard so the test renders just the tab
// nav and a fake outlet.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock TanStack router primitives used by the layout
let mockPathname = '/driver-planning'
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: any) => (
    <a href={String(to)} className={className} data-testid="tab-link">
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet">outlet-content</div>,
  useRouter: () => ({ state: { location: { pathname: mockPathname } } }),
}))

// AppGuard pulls in fetchUser/fetchVersion etc. — stub it to a passthrough.
vi.mock('./containers/AppGuard', () => ({
  AppGuard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-guard">{children}</div>
  ),
}))

import { DriverPlanningLayout } from './DriverPlanningLayout'

describe('DriverPlanningLayout', () => {
  beforeEach(() => {
    mockPathname = '/driver-planning'
  })

  it('renders without crashing', () => {
    const { container } = render(<DriverPlanningLayout />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders all four tab links', () => {
    render(<DriverPlanningLayout />)
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Trips')).toBeInTheDocument()
    expect(screen.getByText('Shipments')).toBeInTheDocument()
  })

  it('renders the AppGuard wrapper around the outlet', () => {
    render(<DriverPlanningLayout />)
    expect(screen.getByTestId('app-guard')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('marks the Availability tab as active when on /driver-planning', () => {
    mockPathname = '/driver-planning'
    render(<DriverPlanningLayout />)
    const links = screen.getAllByTestId('tab-link')
    const availability = links.find((a) => a.textContent === 'Availability')!
    expect(availability.className).toContain('border-primary')
  })

  it('marks the Trips tab as active when on /driver-planning/trips/123', () => {
    mockPathname = '/driver-planning/trips/123'
    render(<DriverPlanningLayout />)
    const links = screen.getAllByTestId('tab-link')
    const trips = links.find((a) => a.textContent === 'Trips')!
    expect(trips.className).toContain('border-primary')
  })
})
