import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

const mocks = vi.hoisted(() => ({
  fetchSavedFilters: vi.fn(async () => [
    { id: 1, name: 'My filter', query: '{}', owner: { first_name: 'Test', last_name: 'User' } },
  ]),
  fetchDefaultFilter: vi.fn(async () => null),
  setDefaultFilter: vi.fn(async () => ({})),
}))

vi.mock('@/features/driver-planning/utils/api', () => ({
  API: {
    fetchSavedShipmentFilters: mocks.fetchSavedFilters,
    fetchShipmentDefaultFilterForUser: mocks.fetchDefaultFilter,
    setDefaultShipmentFilter: mocks.setDefaultFilter,
  },
}))

vi.mock('@/features/driver-planning/redux/shipments', () => ({
  changeShipmentQuery: (q: any) => ({ type: 'shipments/changeShipmentQuery', payload: q }),
  deleteShipmentFilter: (id: any) => ({ type: 'shipments/deleteShipmentFilter', payload: id }),
}))

import FilterModal from './FilterModal'

describe('FilterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title when modal is open', async () => {
    const close = vi.fn()
    const { findByText } = renderWithStore(<FilterModal modalIsOpen={true} closeModal={close} />)
    expect(await findByText('Choose a Filter')).toBeInTheDocument()
  })

  it('calls closeModal when Close button is clicked', async () => {
    const close = vi.fn()
    const { findByText } = renderWithStore(<FilterModal modalIsOpen={true} closeModal={close} />)
    const closeBtn = await findByText('Close')
    fireEvent.click(closeBtn)
    expect(close).toHaveBeenCalled()
  })

  it('loads saved filters from API on mount', async () => {
    const close = vi.fn()
    renderWithStore(<FilterModal modalIsOpen={true} closeModal={close} />)
    await waitFor(() => {
      expect(mocks.fetchSavedFilters).toHaveBeenCalled()
      expect(mocks.fetchDefaultFilter).toHaveBeenCalled()
    })
  })

  it('shows All Filters tab and switches when clicked', async () => {
    const close = vi.fn()
    const { findByText } = renderWithStore(<FilterModal modalIsOpen={true} closeModal={close} />)
    const allFiltersTab = await findByText('All Filters')
    fireEvent.click(allFiltersTab)
    expect(allFiltersTab).toBeInTheDocument()
  })
})
