import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientError } from '@/lib/report-client-error'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches unhandled React render errors and displays a fallback UI instead
 * of a blank or broken page.
 *
 * Reports the crash to the server as well as the console. Console-only was the
 * status quo until 2026-09-17, when a user hit this screen on the Operations
 * section and there was no server-side evidence of it anywhere — see
 * lib/report-client-error.ts.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled React error', error, info.componentStack)
    // Never throws — see report-client-error.ts. A reporter that threw here
    // would re-enter this boundary and loop.
    reportClientError(error, { componentStack: info.componentStack ?? undefined })
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100vh',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <h2>Something went wrong</h2>
            <p>An unexpected error occurred. Please refresh the page or contact support.</p>
          </div>
        )
      )
    }

    return this.props.children
  }
}
