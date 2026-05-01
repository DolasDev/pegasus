import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Table } from './index'

// NOTE: The unit task description asked for sortable header tests, but
// the production `Table` component does NOT implement sorting — it is a
// pure rendering component. Tests below cover the actual contract:
//   - column header labels
//   - row rendering via `property`
//   - row rendering via custom `accessor`
//   - empty rows array (empty tbody)
//   - row data-id attribute (driven by `order_num`)

describe('Table', () => {
  const tableConfig = [
    { label: 'Name', property: 'name' },
    { label: 'Age', property: 'age' },
  ]

  it('renders the column header labels', () => {
    render(<Table rows={[]} tableConfig={tableConfig} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Age')).toBeInTheDocument()
  })

  it('renders one row per item using `property` lookup', () => {
    const rows = [
      { name: 'Alice', age: 30, order_num: 'A1' },
      { name: 'Bob', age: 25, order_num: 'B2' },
    ]
    const { container } = render(<Table rows={rows} tableConfig={tableConfig} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    const bodyRows = container.querySelectorAll('tbody tr')
    expect(bodyRows.length).toBe(2)
  })

  it('renders cells via the `accessor` function when supplied', () => {
    const cfg = [
      { label: 'Full', accessor: (r: any) => `${r.first} ${r.last}` },
    ]
    render(<Table rows={[{ first: 'Ada', last: 'Lovelace' }]} tableConfig={cfg} />)
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('renders an empty tbody when no rows are supplied', () => {
    const { container } = render(<Table rows={[]} tableConfig={tableConfig} />)
    const bodyRows = container.querySelectorAll('tbody tr')
    expect(bodyRows.length).toBe(0)
  })

  it('sets data-id on each row using the `order_num` field', () => {
    const rows = [{ name: 'X', age: 1, order_num: 'XYZ' }]
    const { container } = render(<Table rows={rows} tableConfig={tableConfig} />)
    const tr = container.querySelector('tbody tr')
    expect(tr?.getAttribute('data-id')).toBe('XYZ')
  })
})
