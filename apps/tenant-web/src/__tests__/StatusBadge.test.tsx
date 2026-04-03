import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MoveStatusBadge, QuoteStatusBadge, InvoiceStatusBadge } from '../components/StatusBadge'

describe('MoveStatusBadge', () => {
  it('renders the status text for PENDING', () => {
    render(<MoveStatusBadge status="PENDING" />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('renders the status text for SCHEDULED', () => {
    render(<MoveStatusBadge status="SCHEDULED" />)
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
  })

  it('renders the status text for IN_PROGRESS', () => {
    render(<MoveStatusBadge status="IN_PROGRESS" />)
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('renders the status text for COMPLETED', () => {
    render(<MoveStatusBadge status="COMPLETED" />)
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('renders the status text for CANCELLED', () => {
    render(<MoveStatusBadge status="CANCELLED" />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })
})

describe('QuoteStatusBadge', () => {
  it('renders the status text for DRAFT', () => {
    render(<QuoteStatusBadge status="DRAFT" />)
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('renders the status text for ACCEPTED', () => {
    render(<QuoteStatusBadge status="ACCEPTED" />)
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })
})

describe('InvoiceStatusBadge', () => {
  it('renders the status text for ISSUED', () => {
    render(<InvoiceStatusBadge status="ISSUED" />)
    expect(screen.getByText('Issued')).toBeInTheDocument()
  })

  it('renders the status text for PAID', () => {
    render(<InvoiceStatusBadge status="PAID" />)
    expect(screen.getByText('Paid')).toBeInTheDocument()
  })

  it('renders the status text for VOID', () => {
    render(<InvoiceStatusBadge status="VOID" />)
    expect(screen.getByText('Void')).toBeInTheDocument()
  })
})
