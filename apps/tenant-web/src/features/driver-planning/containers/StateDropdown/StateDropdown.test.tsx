import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { StateDropdown } from './index'
import { renderWithStore } from '../../__test-utils__/render-with-store'

const sampleStates = [
  { geo_id: 1, geo_name: 'California', geo_code: 'CA' },
  { geo_id: 2, geo_name: 'New York', geo_code: 'NY' },
  { geo_id: 3, geo_name: 'Texas', geo_code: 'TX' },
]

describe('StateDropdown', () => {
  it('renders with empty stateList without crashing', () => {
    const { container } = renderWithStore(<StateDropdown />)
    expect(container.querySelector('input')).toBeInTheDocument()
  })

  it('opens menu and renders one option per state with formatted label', () => {
    renderWithStore(<StateDropdown />, { common: { stateList: sampleStates } })

    // react-select uses an input with role="combobox"
    const input = screen.getByRole('combobox')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)

    expect(screen.getByText('California (CA)')).toBeInTheDocument()
    expect(screen.getByText('New York (NY)')).toBeInTheDocument()
    expect(screen.getByText('Texas (TX)')).toBeInTheDocument()
  })

  it('calls onChange with the underlying state value when an option is selected', () => {
    const onChange = vi.fn()
    renderWithStore(<StateDropdown onChange={onChange} />, {
      common: { stateList: sampleStates },
    })

    const input = screen.getByRole('combobox')
    fireEvent.mouseDown(input)
    fireEvent.focus(input)
    fireEvent.click(screen.getByText('New York (NY)'))

    expect(onChange).toHaveBeenCalledTimes(1)
    const [selected] = onChange.mock.calls[0]!
    expect(selected.value).toEqual({ geo_id: 2, geo_name: 'New York', geo_code: 'NY' })
    expect(selected.label).toBe('New York (NY)')
  })

  it('forwards extra props to the underlying Select (e.g. placeholder)', () => {
    renderWithStore(<StateDropdown placeholder="Pick a state" />, {
      common: { stateList: sampleStates },
    })
    expect(screen.getByText('Pick a state')).toBeInTheDocument()
  })
})
