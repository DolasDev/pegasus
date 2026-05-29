// ---------------------------------------------------------------------------
// DriverPlanningLayout smoke tests
//
// The layout now combines:
//   - Redux Provider (real store)
//   - AppGuard (fetches a bunch of data on mount — stubbed here)
//   - <Outlet />
//
// The tab nav was hoisted up into the AppShell sidebar as sub-nav under
// "Operations" (see components/AppShell.tsx). The layout itself just
// renders the providers + outlet.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet">outlet-content</div>,
}))

// AppGuard pulls in fetchUser/fetchVersion etc. — stub it to a passthrough.
vi.mock('./containers/AppGuard', () => ({
  AppGuard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-guard">{children}</div>
  ),
}))

import { DriverPlanningLayout } from './DriverPlanningLayout'

describe('DriverPlanningLayout', () => {
  it('renders without crashing', () => {
    const { container } = render(<DriverPlanningLayout />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders the AppGuard wrapper around the outlet', () => {
    render(<DriverPlanningLayout />)
    expect(screen.getByTestId('app-guard')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('does not render the in-page tab strip (moved to sidebar)', () => {
    render(<DriverPlanningLayout />)
    expect(screen.queryByText('Availability')).not.toBeInTheDocument()
    expect(screen.queryByText('Planning')).not.toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
    expect(screen.queryByText('Shipments')).not.toBeInTheDocument()
  })
})
