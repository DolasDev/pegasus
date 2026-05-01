import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Select } from './index'

const options = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry' },
]

describe('Select', () => {
  it('renders the supplied placeholder when no value is selected', () => {
    render(<Select options={options} placeholder="Choose a fruit" />)
    expect(screen.getByText('Choose a fruit')).toBeInTheDocument()
  })

  it('renders the currently-selected option label', () => {
    render(<Select options={options} value={options[1]} />)
    expect(screen.getByText('Banana')).toBeInTheDocument()
  })

  it('opens the menu and exposes options when navigated via keyboard', () => {
    render(<Select options={options} />)
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.getByText('Banana')).toBeInTheDocument()
    expect(screen.getByText('Cherry')).toBeInTheDocument()
  })

  it('fires onChange with the selected option when an item is clicked', () => {
    const onChange = vi.fn()
    render(<Select options={options} onChange={onChange} />)
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.click(screen.getByText('Cherry'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ value: 'c', label: 'Cherry' })
  })

  it('passes through arbitrary props (e.g. isDisabled) to react-select', () => {
    const { container } = render(<Select options={options} isDisabled />)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.disabled).toBe(true)
  })
})
