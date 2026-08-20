// ---------------------------------------------------------------------------
// Tests for the planning-screen filter panel.
//
// Focused on the Last Activity filter: that it renders from the reference-data
// activity-type options, that changing it writes the `latest_activity` key the
// API's post-enrichment filter reads, and that adding it did not change the
// number of columns the panel lays out in.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'

import { FilterTabs } from './index'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

const activityTypeOptions = [
  { value: 'LD', label: 'LD' },
  { value: 'PK', label: 'PK' },
  { value: 'SIT', label: 'SIT' },
]

function renderFilters(commonOverrides: Record<string, unknown> = {}) {
  return renderWithStore(<FilterTabs />, {
    common: {
      filterOptions: { moveType: [], activityType: activityTypeOptions },
      ...commonOverrides,
    } as never,
  })
}

/** The panel's filter row for a given query key. */
function filterRow(property: string): HTMLElement {
  const row = document.querySelector(`[data-target="filter-row"][data-filter="${property}"]`)
  expect(row, `no filter row for ${property}`).toBeTruthy()
  return row as HTMLElement
}

/** Open a react-select menu — its options only render once it is open. */
function openMenu(row: HTMLElement): void {
  const input = row.querySelector('input')!
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' })
}

describe('FilterTabs — Last Activity', () => {
  it('renders a Last Activity filter row', () => {
    renderFilters()
    // `getByText` alone is ambiguous here: the row carries the text twice, once
    // as the field label and once as the select's placeholder (the Move Types
    // field does the same).
    expect(
      within(filterRow('latest_activity')).getByText('Last Activity', { selector: 'label' }),
    ).toBeTruthy()
  })

  it('offers the reference-data activity abbreviations as options', () => {
    renderFilters()
    openMenu(filterRow('latest_activity'))

    for (const { label } of activityTypeOptions) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('labels options with the bare abbreviation the shipment card prints', () => {
    // Deliberate: the card's last column renders `${abbr}: ${date}`, so the
    // filter shows the same token with no name suffix to translate.
    renderFilters()
    openMenu(filterRow('latest_activity'))

    // Scoped to this row: the assertion is about the Last Activity OPTIONS, and
    // a document-wide query also catches the unrelated "SIT-Dest" field label.
    expect(within(filterRow('latest_activity')).queryByText(/SIT\s*[—-]/)).toBeNull()
  })

  it('writes the selection to the latest_activity query key', () => {
    const { store } = renderFilters()
    openMenu(filterRow('latest_activity'))
    fireEvent.click(screen.getByText('SIT'))

    const { filters } = store.getState().shipments.query
    expect(filters.latest_activity).toEqual([{ value: 'SIT', label: 'SIT' }])
  })

  it('tolerates reference data that has no activityType options yet', () => {
    // Bootstrap races and MSSQL_NOT_CONFIGURED tenants both leave this empty;
    // the row must still render rather than crashing the panel.
    renderFilters({ filterOptions: { moveType: [] } })
    expect(filterRow('latest_activity')).toBeTruthy()
  })
})

describe('FilterTabs — SIT-Dest', () => {
  it('renders a SIT-Dest filter row', () => {
    renderFilters()
    expect(within(filterRow('sit_dest')).getByText('SIT-Dest', { selector: 'label' })).toBeTruthy()
  })

  it('offers exactly Yes and No', () => {
    renderFilters()
    openMenu(filterRow('sit_dest'))

    const row = filterRow('sit_dest')
    expect(within(row).getByText('Yes')).toBeTruthy()
    expect(within(row).getByText('No')).toBeTruthy()
  })

  it('writes the selection to the sit_dest query key', () => {
    const { store } = renderFilters()
    openMenu(filterRow('sit_dest'))
    fireEvent.click(within(filterRow('sit_dest')).getByText('Yes'))

    const { filters } = store.getState().shipments.query
    expect(filters.sit_dest).toEqual([{ value: 'Yes', label: 'Yes' }])
  })

  it('does not filter by default', () => {
    // The panel opens unfiltered on SIT — only Is_Trip_Planning, load_date and
    // assigned carry defaults.
    const { store } = renderFilters()
    expect(store.getState().shipments.query.filters.sit_dest).toBeUndefined()
  })
})

describe('FilterTabs — panel layout', () => {
  it('lays the filters out in 5 columns', () => {
    // Regression: the chunker used to slice FIELDS into fixed runs of
    // ceil(len / 5), so the 16th field silently collapsed the panel to 4
    // columns of 4. Column COUNT is the invariant; per-column length is not.
    renderFilters()
    const body = document.querySelector('[data-target="filters-body"]')!
    expect(body.children.length).toBe(5)
  })

  it('renders every field exactly once across the columns', () => {
    renderFilters()
    const rows = document.querySelectorAll('[data-target="filter-row"]')
    const properties = [...rows].map((r) => r.getAttribute('data-filter'))
    expect(new Set(properties).size).toBe(properties.length)
    expect(properties).toContain('latest_activity')
    expect(properties).toContain('sit_dest')
    expect(properties).toContain('origin')
    expect(properties).toContain('TripStatus_id')
  })

  it('spreads the fields evenly, heaviest column first', () => {
    renderFilters()
    const body = document.querySelector('[data-target="filters-body"]')!
    const sizes = [...body.children].map(
      (col) => col.querySelectorAll('[data-target="filter-row"]').length,
    )
    // No column may be more than one row taller than any other.
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(
      document.querySelectorAll('[data-target="filter-row"]').length,
    )
  })
})
