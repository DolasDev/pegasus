// ---------------------------------------------------------------------------
// Unit tests for ErrorBoundary.
//
// The boundary's fallback UI is the "Something went wrong" screen a user
// actually reported on 2026-09-17. What was missing then was any server-side
// trace of it — so the assertion that matters here is that catching a crash
// also reports it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const { mockReport } = vi.hoisted(() => ({ mockReport: vi.fn() }))

vi.mock('@/lib/report-client-error', () => ({ reportClientError: mockReport }))

import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('render exploded')
}

beforeEach(() => {
  mockReport.mockReset()
  // React logs caught render errors; keep the suite output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders the fallback instead of a broken page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText(/something went wrong/i)).toBeTruthy()
  })

  it('reports the crash so it is not console-only', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(mockReport).toHaveBeenCalled()
    const [error, context] = mockReport.mock.calls[0]!
    expect((error as Error).message).toBe('render exploded')
    // The component stack is what names the screen that crashed.
    expect((context as { componentStack?: string }).componentStack).toContain('Boom')
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('all good')).toBeTruthy()
    expect(mockReport).not.toHaveBeenCalled()
  })
})
