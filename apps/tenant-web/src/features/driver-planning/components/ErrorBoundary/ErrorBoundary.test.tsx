import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// The fallback UI renders <Link to="/trips">. router-compat resolves Link from
// @tanstack/react-router which requires a Router context. Mock with a plain
// <a> so we can render in isolation.
vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => (
    <a href={typeof props.to === 'string' ? props.to : ''} className={props.className} onClick={props.onClick}>
      {props.children}
    </a>
  ),
  useLocation: () => ({}),
  useNavigate: () => () => {},
  useParams: () => ({}),
}))

// Silence the logger output that ErrorBoundary writes via console.error.
vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { ErrorBoundary } from './index'

const Boom: React.FC = () => {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React still logs the error to console.error from its own machinery.
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="kid">hi</div>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('kid')).toBeInTheDocument()
  })

  it('renders the default fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/an error occurred/i)).toBeInTheDocument()
    expect(screen.getByText(/support@dolas\.dev/)).toBeInTheDocument()
  })

  it('renders a custom ErrorComponent when provided and a child throws', () => {
    const Custom: React.FC = () => <div data-testid="custom-fallback">custom!</div>
    render(
      <ErrorBoundary ErrorComponent={Custom}>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
  })

  it('renders the fallback when showError prop is true (no error needed)', () => {
    render(
      <ErrorBoundary showError={true}>
        <div data-testid="kid">hi</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText(/an error occurred/i)).toBeInTheDocument()
    // Children should NOT render in this branch
    expect(screen.queryByTestId('kid')).not.toBeInTheDocument()
  })

  it('renders custom ErrorComponent when showError prop is true', () => {
    const Custom: React.FC = () => <div data-testid="custom-fallback">custom!</div>
    render(
      <ErrorBoundary showError={true} ErrorComponent={Custom}>
        <div>kid</div>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
  })

  it('clicking the close link in the fallback resets the error state', () => {
    // Use a child whose throwing can be toggled off by parent state, so that
    // after closeErrorMessage the boundary can render children again.
    const Toggle: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
      if (shouldThrow) throw new Error('boom')
      return <div data-testid="recovered">ok</div>
    }
    const Wrapper: React.FC = () => {
      const [shouldThrow, setShouldThrow] = React.useState(true)
      return (
        <div>
          <button onClick={() => setShouldThrow(false)} data-testid="fix">fix</button>
          <ErrorBoundary>
            <Toggle shouldThrow={shouldThrow} />
          </ErrorBoundary>
        </div>
      )
    }
    render(<Wrapper />)
    expect(screen.getByText(/an error occurred/i)).toBeInTheDocument()
    // Stop the child from throwing first, then click the close link.
    fireEvent.click(screen.getByTestId('fix'))
    // The close link is the <a> inside the fallback (rendered via mocked Link).
    const closeLink = screen.getByText(/an error occurred/i)
      .parentElement!
      .querySelector('a') as HTMLAnchorElement
    expect(closeLink).toBeTruthy()
    fireEvent.click(closeLink)
    expect(screen.getByTestId('recovered')).toBeInTheDocument()
  })
})
