import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTable, type Column } from '../components/DataTable'

type Row = { id: string; name: string; status: string }

const columns: Column<Row>[] = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Name' },
  { key: 'status', header: 'Status' },
]

const rows: Row[] = [
  { id: 'r-1', name: 'Alice', status: 'Active' },
  { id: 'r-2', name: 'Bob', status: 'Inactive' },
]

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable data={[]} columns={columns} />)
    expect(screen.getByText('ID')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('renders one row per data item', () => {
    render(<DataTable data={rows} columns={columns} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('renders cell values using custom cell renderer when provided', () => {
    const cols: Column<Row>[] = [
      ...columns,
      {
        key: 'name',
        header: 'Custom',
        cell: (row) => <span data-testid="custom">{row.name.toUpperCase()}</span>,
      },
    ]
    render(<DataTable data={[rows[0]!]} columns={cols} />)
    expect(screen.getByTestId('custom').textContent).toBe('ALICE')
  })

  it('renders the empty state message when data is empty', () => {
    render(<DataTable data={[]} columns={columns} />)
    expect(screen.getByText('No results.')).toBeInTheDocument()
  })
})
