import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithStore } from '../../../../__test-utils__/render-with-store'

const saveShipmentsFilterMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/features/driver-planning/utils/api', () => ({
  API: {
    saveShipmentsFilter: saveShipmentsFilterMock,
    fetchShipments: vi.fn(() => Promise.resolve([])),
    fetchDrivers: vi.fn(() => Promise.resolve([])),
    fetchStates: vi.fn(() => Promise.resolve([])),
  },
}))

import { FilterTabs } from './index'

const filteredQuery = {
  searchTerm: '',
  filters: {
    Is_Trip_Planning: true,
    load_date: ['2024-01-01', '2024-01-31'],
    assigned: [{ label: 'No', value: 'No' }],
    origin: [{ label: 'TX', value: 'TX' }],
  },
  sortBy: { value: 'load_date2', order: 'asc' },
}

const sampleUser = { code: 'U1', first_name: 'Sam' }

describe('SaveFilterModal (via FilterTabs)', () => {
  beforeEach(() => {
    saveShipmentsFilterMock.mockClear()
  })

  it('opens the modal when the Save link is clicked', async () => {
    renderWithStore(<FilterTabs />, {
      shipments: { query: filteredQuery } as any,
      user: { user: sampleUser } as any,
      common: {
        loading: false,
        driversList: [],
        tripStatuses: [],
        stateList: [],
        zoneList: [],
        plannersList: [],
        dispatcherList: [],
        filterOptions: {},
      } as any,
    })
    fireEvent.click(screen.getByText('Save'))
    // Heading "Save Filter" — disambiguated from the submit button of the same
    // label by selecting role=heading.
    expect(await screen.findByRole('heading', { name: 'Save Filter' })).toBeInTheDocument()
  })

  it('submits saveShipmentsFilter with the current query, user code, and entered name', async () => {
    renderWithStore(<FilterTabs />, {
      shipments: { query: filteredQuery } as any,
      user: { user: sampleUser } as any,
      common: {
        loading: false,
        driversList: [],
        tripStatuses: [],
        stateList: [],
        zoneList: [],
        plannersList: [],
        dispatcherList: [],
        filterOptions: {},
      } as any,
    })
    fireEvent.click(screen.getByText('Save'))
    const heading = await screen.findByRole('heading', { name: 'Save Filter' })
    const dialog = heading.closest('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    const nameInput = dialog.querySelector('input[placeholder="Enter name"]') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'My TX shipments' } })
    const submit = dialog.querySelector('button[type="submit"]') as HTMLButtonElement
    fireEvent.click(submit)
    await waitFor(() => {
      expect(saveShipmentsFilterMock).toHaveBeenCalledTimes(1)
    })
    expect(saveShipmentsFilterMock).toHaveBeenCalledWith({
      name: 'My TX shipments',
      is_default: false,
      is_public: false,
      user_code: 'U1',
      query: filteredQuery,
    })
  })

  it('closes the modal after a successful save', async () => {
    renderWithStore(<FilterTabs />, {
      shipments: { query: filteredQuery } as any,
      user: { user: sampleUser } as any,
      common: {
        loading: false,
        driversList: [],
        tripStatuses: [],
        stateList: [],
        zoneList: [],
        plannersList: [],
        dispatcherList: [],
        filterOptions: {},
      } as any,
    })
    fireEvent.click(screen.getByText('Save'))
    const heading = await screen.findByRole('heading', { name: 'Save Filter' })
    const dialog = heading.closest('[role="dialog"]') as HTMLElement
    const nameInput = dialog.querySelector('input[placeholder="Enter name"]') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'X' } })
    fireEvent.click(dialog.querySelector('button[type="submit"]') as HTMLButtonElement)
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Save Filter' })).not.toBeInTheDocument()
    })
  })

  it('does not render the Save link when no filters are set', () => {
    renderWithStore(<FilterTabs />, {
      shipments: { query: { searchTerm: '', filters: {}, sortBy: {} } } as any,
      user: { user: sampleUser } as any,
      common: {
        loading: false,
        driversList: [],
        tripStatuses: [],
        stateList: [],
        zoneList: [],
        plannersList: [],
        dispatcherList: [],
        filterOptions: {},
      } as any,
    })
    expect(screen.queryByText('Save')).not.toBeInTheDocument()
  })
})
