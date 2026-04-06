import React from 'react'
import { Link } from 'react-router'
import styles from './ErrorBoundary.module.css'
import logger from '../../utils/logger'

interface ErrorBoundaryProps {
  children?: React.ReactNode
  ErrorComponent?: React.ComponentType
  showError?: boolean
}

interface ErrorBoundaryState {
  error: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: false,
  }
  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      error: true,
    }
  }

  override componentDidCatch(e: Error): void {
    logger.error(e)
  }

  closeErrorMessage = (): void => {
    this.setState({ error: false })
  }

  override render(): React.ReactNode {
    const { ErrorComponent } = this.props
    if (this.state.error || this.props.showError) {
      if (ErrorComponent) {
        return <ErrorComponent />
      }
      return (
        <div className={styles.container}>
          <Link className={styles.closeErrorMessage} to={'/trips'} onClick={this.closeErrorMessage}>
            <i className="fa fa-close"></i>
          </Link>
          <h1>An error occurred</h1>
          <p>
            Please try reloading the application. If this continues, contact{' '}
            <a href="mailto:support@dolas.dev">support@dolas.dev</a>
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
