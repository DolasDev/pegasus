import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DatePicker } from './index'

describe('DatePicker', () => {
  it('renders an input element', () => {
    render(<DatePicker onChange={() => {}} />)
    const input = document.querySelector('input') as HTMLInputElement
    expect(input).toBeInTheDocument()
  })

  it('displays the supplied date value in the input', () => {
    const date = new Date(2024, 0, 15)
    render(<DatePicker selected={date} onChange={() => {}} />)
    const input = document.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('01/15/2024')
  })

  it('calls onChange when a new date is typed into the input', () => {
    const onChange = vi.fn()
    const initial = new Date(2024, 0, 15)
    render(<DatePicker selected={initial} onChange={onChange} />)
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '02/20/2024' } })
    expect(onChange).toHaveBeenCalled()
    const arg = onChange.mock.lastCall?.[0] as Date | null
    expect(arg).toBeInstanceOf(Date)
    expect(arg?.getFullYear()).toBe(2024)
    expect(arg?.getMonth()).toBe(1)
    expect(arg?.getDate()).toBe(20)
  })

  it('opens a calendar popper when the input is focused', () => {
    render(<DatePicker selected={new Date(2024, 0, 15)} onChange={() => {}} />)
    const input = document.querySelector('input') as HTMLInputElement
    fireEvent.focus(input)
    expect(document.querySelector('.react-datepicker')).toBeTruthy()
  })

  it('passes placeholder text through to the underlying input', () => {
    render(<DatePicker placeholderText="Pick a date" onChange={() => {}} />)
    expect(screen.getByPlaceholderText('Pick a date')).toBeInTheDocument()
  })
})
