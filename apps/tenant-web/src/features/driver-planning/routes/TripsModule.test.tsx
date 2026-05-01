// ---------------------------------------------------------------------------
// TripsModule smoke test — composition only.
// ---------------------------------------------------------------------------

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'

vi.mock('../containers/Trips', () => ({
  Trips: () => <div data-testid="mock-trips" />,
}))

import { TripsModule } from './TripsModule'
import { renderWithStore } from '../__test-utils__/render-with-store'

describe('TripsModule', () => {
  it('renders without crashing and mounts the Trips container', () => {
    renderWithStore(<TripsModule />)
    expect(screen.getByTestId('mock-trips')).toBeInTheDocument()
  })

  it('wraps Trips in a TripsModule__container element', () => {
    const { container } = renderWithStore(<TripsModule />)
    expect(container.querySelector('.TripsModule__container')).toBeTruthy()
  })
})
