import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { DriverTypeahead } from './index'
import { renderWithStore } from '../../__test-utils__/render-with-store'

const sampleDrivers = [
  { driver_id: 11, driver_name: 'ALICE SMITH' },
  { driver_id: 12, driver_name: 'BOB JONES' },
  { driver_id: 13, driver_name: 'ALAN TURING' },
]

function openMenu(): HTMLInputElement {
  const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
  // Downshift v9 opens the menu on ArrowDown without altering the value or filter.
  fireEvent.focus(input)
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  return input
}

describe('DriverTypeahead', () => {
  it('always appends a "None" option to the drivers list', () => {
    renderWithStore(<DriverTypeahead />, { common: { driversList: [] } })
    openMenu()
    // "None" option, formatted via startCase
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders drivers from store with start-cased labels', () => {
    renderWithStore(<DriverTypeahead />, { common: { driversList: sampleDrivers } })
    openMenu()

    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
    // None still appended
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('filters options based on typed input fragment', () => {
    renderWithStore(<DriverTypeahead />, { common: { driversList: sampleDrivers } })
    const input = openMenu()

    fireEvent.change(input, { target: { value: 'al' } })

    // Both Alice and Alan match, Bob does not
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Alan Turing')).toBeInTheDocument()
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument()
  })

  it('fires onChange when a driver option is clicked', () => {
    const onChange = vi.fn()
    renderWithStore(<DriverTypeahead onChange={onChange} />, {
      common: { driversList: sampleDrivers },
    })
    openMenu()

    const option = screen.getByText('Bob Jones')
    fireEvent.click(option)

    expect(onChange).toHaveBeenCalled()
    // Find the call where a real selection was passed (Downshift may emit
    // multiple state changes; one carries the selectedItem object).
    const selectionCall = onChange.mock.calls.find(
      ([arg]) => arg && typeof arg === 'object' && arg.value && arg.value.driver_id === 12,
    )
    expect(selectionCall).toBeTruthy()
    expect(selectionCall![0].label).toBe('Bob Jones')
  })

  it('fires onChange with null when input is cleared', () => {
    const onChange = vi.fn()
    renderWithStore(<DriverTypeahead onChange={onChange} />, {
      common: { driversList: sampleDrivers },
    })
    const input = openMenu()

    fireEvent.change(input, { target: { value: 'al' } })
    onChange.mockClear()
    fireEvent.change(input, { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('handles drivers with empty names without crashing', () => {
    renderWithStore(<DriverTypeahead />, {
      common: { driversList: [{ driver_id: 99, driver_name: '' }] },
    })
    openMenu()
    expect(screen.getByText('None')).toBeInTheDocument()
  })
})
