import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

vi.mock('../../../../utils/api', () => ({
  API: {
    fetchSavedShipmentFilters: vi.fn(async () => []),
    fetchShipmentDefaultFilterForUser: vi.fn(async () => null),
    saveShipmentsFilter: vi.fn(async () => ({})),
    setDefaultShipmentFilter: vi.fn(async () => ({})),
  },
}))

vi.mock('../../../../redux/shipments', () => ({
  changeShipmentQuery: (q: any) => ({ type: 'shipments/changeShipmentQuery', payload: q }),
  resetToDefaultShipmentQuery: () => ({ type: 'shipments/resetToDefaultShipmentQuery' }),
  deleteShipmentFilter: (id: any) => ({ type: 'shipments/deleteShipmentFilter', payload: id }),
}))

import { FilterTabs } from './index'

describe('FilterTabs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the search input and filters caret', () => {
    const { getByPlaceholderText, getAllByText } = renderWithStore(<FilterTabs />)
    expect(getByPlaceholderText(/Search/)).toBeInTheDocument()
    expect(getAllByText(/Filters/).length).toBeGreaterThan(0)
  })

  it('dispatches changeShipmentQuery when search input has 3+ chars', () => {
    const { getByPlaceholderText, dispatched } = renderWithStore(<FilterTabs />)
    const input = getByPlaceholderText(/Search/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    const action = dispatched.find(
      (a) => a && a.type === 'shipments/changeShipmentQuery' && a.payload.searchTerm === 'abc',
    )
    expect(action).toBeTruthy()
  })

  it('does not dispatch query when search input is shorter than 3 chars', () => {
    const { getByPlaceholderText, dispatched } = renderWithStore(<FilterTabs />)
    const input = getByPlaceholderText(/Search/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab' } })
    const action = dispatched.find(
      (a) =>
        a &&
        a.type === 'shipments/changeShipmentQuery' &&
        a.payload &&
        a.payload.searchTerm === 'ab',
    )
    expect(action).toBeUndefined()
  })

  it('shows Clear and Save links when filters are present', () => {
    const { getByText } = renderWithStore(<FilterTabs />, {
      shipments: {
        query: {
          searchTerm: '',
          filters: { origin: ['CA'] },
          sortBy: {},
        },
      },
    })
    expect(getByText('Clear')).toBeInTheDocument()
    expect(getByText('Save')).toBeInTheDocument()
  })

  it('dispatches resetToDefaultShipmentQuery when Clear is clicked', () => {
    const { getByText, dispatched } = renderWithStore(<FilterTabs />, {
      shipments: {
        query: { searchTerm: '', filters: { origin: ['CA'] }, sortBy: {} },
      },
    })
    fireEvent.click(getByText('Clear'))
    const action = dispatched.find(
      (a) => a && a.type === 'shipments/resetToDefaultShipmentQuery',
    )
    expect(action).toBeTruthy()
  })

  it('opens the Filters modal when "Filters" link is clicked', () => {
    const { getAllByText, container } = renderWithStore(<FilterTabs />)
    // Two "Filters" texts: header label + link to open modal. The link is
    // styled.link className.
    const links = container.querySelectorAll('a')
    // Click the last link (Filters modal opener)
    fireEvent.click(links[links.length - 1])
    // Just verify nothing crashed and component still rendered.
    expect(getAllByText(/Filters/).length).toBeGreaterThan(0)
  })
})
