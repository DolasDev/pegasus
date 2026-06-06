import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Table } from './index'

// Tests cover the actual contract of the (generic) `Table` component:
//   - column header labels
//   - row rendering via `property`
//   - row rendering via custom `accessor`
//   - empty rows array (empty tbody)
//   - row data-id attribute (only when `rowId` is provided)
//   - duplicate column labels render without React key warnings

describe('Table', () => {
  const tableConfig = [
    { label: 'Name', property: 'name' as const },
    { label: 'Age', property: 'age' as const },
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
    interface Person {
      first: string
      last: string
    }
    const cfg = [{ label: 'Full', accessor: (r: Person) => `${r.first} ${r.last}` }]
    render(<Table rows={[{ first: 'Ada', last: 'Lovelace' }]} tableConfig={cfg} />)
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('renders an empty tbody when no rows are supplied', () => {
    const { container } = render(<Table rows={[]} tableConfig={tableConfig} />)
    const bodyRows = container.querySelectorAll('tbody tr')
    expect(bodyRows.length).toBe(0)
  })

  it('omits the `data-id` attribute when no `rowId` prop is provided', () => {
    const rows = [{ name: 'X', age: 1 }]
    const { container } = render(<Table rows={rows} tableConfig={tableConfig} />)
    const tr = container.querySelector('tbody tr')
    expect(tr?.hasAttribute('data-id')).toBe(false)
  })

  it('stamps `data-id` on each row using the `rowId` accessor', () => {
    const rows = [
      { name: 'X', age: 1, order_num: 'XYZ' },
      { name: 'Y', age: 2, order_num: 42 },
    ]
    const { container } = render(
      <Table rows={rows} tableConfig={tableConfig} rowId={(row) => row.order_num} />,
    )
    const trs = container.querySelectorAll('tbody tr')
    expect(trs[0]?.getAttribute('data-id')).toBe('XYZ')
    // Numeric ids are coerced to strings on the DOM attribute.
    expect(trs[1]?.getAttribute('data-id')).toBe('42')
  })

  describe('duplicate column labels', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    afterEach(() => {
      errorSpy.mockClear()
    })

    it('render without React duplicate-key warnings', () => {
      const cfg = [
        { label: '', property: 'name' as const },
        { label: 'Middle', property: 'name' as const },
        { label: '', property: 'age' as const },
      ]
      const rows = [{ name: 'Alice', age: 30 }]
      const { container } = render(<Table rows={rows} tableConfig={cfg} />)
      const headers = container.querySelectorAll('thead th')
      expect(headers.length).toBe(3)
      const keyWarnings = errorSpy.mock.calls.filter((call) =>
        String(call[0] ?? '').includes('Encountered two children with the same key'),
      )
      expect(keyWarnings).toEqual([])
    })
  })

  describe('sortable headers', () => {
    it('does not make headers clickable when `onSort` is omitted', () => {
      const { container } = render(<Table rows={[]} tableConfig={tableConfig} />)
      const sortable = container.querySelectorAll(
        'thead th[data-target="shipment-table-sort-header"]',
      )
      expect(sortable.length).toBe(0)
    })

    it('calls `onSort` with the column key (defaulting to `property`) on header click', () => {
      const onSort = vi.fn()
      render(<Table rows={[]} tableConfig={tableConfig} onSort={onSort} />)
      fireEvent.click(screen.getByText('Age'))
      expect(onSort).toHaveBeenCalledWith('age')
    })

    it('uses an explicit `sortKey` over `property` when provided', () => {
      const onSort = vi.fn()
      const cfg = [{ label: 'Pack Range', property: 'pack_date' as const, sortKey: 'pack_date2' }]
      render(<Table rows={[]} tableConfig={cfg} onSort={onSort} />)
      fireEvent.click(screen.getByText('Pack Range'))
      expect(onSort).toHaveBeenCalledWith('pack_date2')
    })

    it('does not make a column sortable when it has neither `property` nor `sortKey`', () => {
      const onSort = vi.fn()
      const cfg = [{ label: 'Actions', accessor: () => 'x' }]
      const { container } = render(<Table rows={[]} tableConfig={cfg} onSort={onSort} />)
      const th = container.querySelector('thead th')
      expect(th?.getAttribute('data-target')).toBeNull()
      fireEvent.click(screen.getByText('Actions'))
      expect(onSort).not.toHaveBeenCalled()
    })

    it('marks the active column with `aria-sort` reflecting the order', () => {
      const onSort = vi.fn()
      const { container, rerender } = render(
        <Table
          rows={[]}
          tableConfig={tableConfig}
          onSort={onSort}
          sortBy={{ value: 'age', order: 'asc' }}
        />,
      )
      const ageTh = container.querySelector('thead th[data-sort="age"]')
      const nameTh = container.querySelector('thead th[data-sort="name"]')
      expect(ageTh?.getAttribute('aria-sort')).toBe('ascending')
      expect(nameTh?.getAttribute('aria-sort')).toBeNull()

      rerender(
        <Table
          rows={[]}
          tableConfig={tableConfig}
          onSort={onSort}
          sortBy={{ value: 'age', order: 'desc' }}
        />,
      )
      expect(container.querySelector('thead th[data-sort="age"]')?.getAttribute('aria-sort')).toBe(
        'descending',
      )
    })
  })

  it('compiles with a typed generic row shape', () => {
    // Compile-time smoke: `property` is constrained to `keyof T & string`.
    interface Row {
      name: string
    }
    const cfg = [{ label: 'Name', property: 'name' as const }]
    const rows: Row[] = [{ name: 'Smoke' }]
    render(<Table<Row> rows={rows} tableConfig={cfg} />)
    expect(screen.getByText('Smoke')).toBeInTheDocument()
  })
})
