import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../components/EmptyState'

describe('EmptyState', () => {
  it('renders default title and description when no props given', () => {
    render(<EmptyState />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Nothing to show here yet.')).toBeInTheDocument()
  })

  it('renders custom title and description', () => {
    render(<EmptyState title="No customers" description="Add a customer to get started." />)
    expect(screen.getByText('No customers')).toBeInTheDocument()
    expect(screen.getByText('Add a customer to get started.')).toBeInTheDocument()
  })

  it('renders the action slot when provided', () => {
    render(<EmptyState action={<button>Add one</button>} />)
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument()
  })

  it('does not crash when action is omitted', () => {
    const { container } = render(<EmptyState title="Empty" />)
    expect(container).toBeTruthy()
  })
})
