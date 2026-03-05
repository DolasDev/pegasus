import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '../components/PageHeader'

describe('PageHeader', () => {
  it('renders the title', () => {
    render(<PageHeader title="Customers" />)
    expect(screen.getByRole('heading', { name: 'Customers' })).toBeInTheDocument()
  })

  it('renders breadcrumbs when provided', () => {
    render(<PageHeader title="Detail" breadcrumbs={[{ label: 'Home' }, { label: 'Customers' }]} />)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Customers')).toBeInTheDocument()
  })

  it('renders the action slot when provided', () => {
    render(<PageHeader title="Moves" action={<button>New Move</button>} />)
    expect(screen.getByRole('button', { name: 'New Move' })).toBeInTheDocument()
  })

  it('does not render breadcrumbs when not provided', () => {
    render(<PageHeader title="Invoices" />)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
