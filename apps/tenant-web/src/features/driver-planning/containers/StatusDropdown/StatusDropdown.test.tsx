import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { StatusDropdown } from './index'
import { renderWithStore } from '../../__test-utils__/render-with-store'

const sampleStatuses = [
  { status_id: 1, status: 'Pending' },
  { status_id: 2, status: 'In Progress' },
  { status_id: 3, status: 'Completed' },
]

describe('StatusDropdown', () => {
  it('renders without crashing when tripStatuses is empty', () => {
    const { container } = renderWithStore(<StatusDropdown />)
    expect(container.querySelector('input')).toBeInTheDocument()
  })

  it('opens menu and renders one option per status with the status label', () => {
    renderWithStore(<StatusDropdown />, { common: { tripStatuses: sampleStatuses } })

    const input = screen.getByRole('combobox')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('calls onChange with the status_id when an option is selected', () => {
    const onChange = vi.fn()
    renderWithStore(<StatusDropdown onChange={onChange} />, {
      common: { tripStatuses: sampleStatuses },
    })

    const input = screen.getByRole('combobox')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)
    fireEvent.click(screen.getByText('Completed'))

    expect(onChange).toHaveBeenCalledTimes(1)
    const [selected] = onChange.mock.calls[0]!
    expect(selected.value).toBe(3)
    expect(selected.label).toBe('Completed')
  })

  it('forwards extra props (placeholder) to the underlying Select', () => {
    renderWithStore(<StatusDropdown placeholder="Choose status" />, {
      common: { tripStatuses: sampleStatuses },
    })
    expect(screen.getByText('Choose status')).toBeInTheDocument()
  })
})
