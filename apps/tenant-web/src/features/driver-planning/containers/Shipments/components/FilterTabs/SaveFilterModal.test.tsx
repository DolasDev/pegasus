import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, waitFor, screen } from '@testing-library/react'
import { renderWithStore } from '../../../../__test-utils__/render-with-store'

const mocks = vi.hoisted(() => ({
  saveShipmentsFilter: vi.fn(async () => ({})),
}))

vi.mock('@/features/driver-planning/utils/api', () => ({
  API: {
    saveShipmentsFilter: mocks.saveShipmentsFilter,
  },
}))

import SaveFilterModal from './SaveFilterModal'

// Find the submit button (vs the dialog title both saying "Save Filter")
function getSaveButton(): HTMLButtonElement {
  const candidates = screen.getAllByText('Save Filter')
  const btn = candidates.find((el) => el.tagName === 'BUTTON') as HTMLButtonElement | undefined
  if (!btn) throw new Error('Save Filter button not found')
  return btn
}

describe('SaveFilterModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the title and inputs when open', async () => {
    const close = vi.fn()
    renderWithStore(<SaveFilterModal modalIsOpen={true} closeModal={close} />)
    expect(await screen.findByPlaceholderText('Enter name')).toBeInTheDocument()
    expect(screen.getAllByText('Save Filter').length).toBeGreaterThan(0)
  })

  it('calls closeModal when Cancel is clicked', async () => {
    const close = vi.fn()
    renderWithStore(<SaveFilterModal modalIsOpen={true} closeModal={close} />)
    fireEvent.click(await screen.findByText('Cancel'))
    expect(close).toHaveBeenCalled()
  })

  it('saves filter and closes modal when Save Filter button is clicked', async () => {
    const close = vi.fn()
    renderWithStore(<SaveFilterModal modalIsOpen={true} closeModal={close} />)
    const input = (await screen.findByPlaceholderText('Enter name')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'My new filter' } })
    fireEvent.click(getSaveButton())
    await waitFor(() => {
      expect(mocks.saveShipmentsFilter).toHaveBeenCalled()
      expect(close).toHaveBeenCalled()
    })
    const arg = (mocks.saveShipmentsFilter.mock.calls as any[])[0][0] as any
    expect(arg.name).toBe('My new filter')
    expect(arg.is_default).toBe(false)
    expect(arg.is_public).toBe(false)
  })

  it('toggles is_default when Make Default checkbox is checked', async () => {
    const close = vi.fn()
    renderWithStore(<SaveFilterModal modalIsOpen={true} closeModal={close} />)
    const input = (await screen.findByPlaceholderText('Enter name')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'X' } })
    // Dialog renders into a portal; query from document body
    const checkboxes = document.body.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(2)
    fireEvent.click(checkboxes[0]) // Make Default
    fireEvent.click(getSaveButton())
    await waitFor(() => expect(mocks.saveShipmentsFilter).toHaveBeenCalled())
    const arg = (mocks.saveShipmentsFilter.mock.calls as any[])[0][0] as any
    expect(arg.is_default).toBe(true)
  })
})
