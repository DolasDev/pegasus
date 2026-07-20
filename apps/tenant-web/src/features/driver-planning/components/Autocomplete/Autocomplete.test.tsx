import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Autocomplete } from './index'

type Option = { label: string; value?: unknown }

const options: Option[] = [
  { label: 'Apple', value: 'apple' },
  { label: 'Banana', value: 'banana' },
  { label: 'Cherry', value: 'cherry' },
]

describe('Autocomplete', () => {
  it('renders an input field with the default placeholder', () => {
    render(<Autocomplete options={options} />)
    expect(screen.getByPlaceholderText('Enter a name')).toBeInTheDocument()
  })

  it('does not show menu items when closed', () => {
    render(<Autocomplete options={options} />)
    expect(screen.queryByText('Apple')).not.toBeInTheDocument()
    expect(screen.queryByText('Banana')).not.toBeInTheDocument()
  })

  it('opens the menu and lists matching options when the user types', () => {
    render(<Autocomplete options={options} />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    // Typing a substring that matches every option should reveal the menu
    // with all options. Downshift opens the menu in response to input changes.
    fireEvent.change(input, { target: { value: 'a' } })
    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.getByText('Banana')).toBeInTheDocument()
    // 'Cherry' does not contain 'a' so it should be filtered out
    expect(screen.queryByText('Cherry')).not.toBeInTheDocument()
  })

  it('filters options as the user types using the default filter', () => {
    render(<Autocomplete options={options} />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'an' } })
    // "Banana" matches "an", "Apple" and "Cherry" do not
    expect(screen.getByText('Banana')).toBeInTheDocument()
    expect(screen.queryByText('Apple')).not.toBeInTheDocument()
    expect(screen.queryByText('Cherry')).not.toBeInTheDocument()
  })

  it('uses a custom filter function when supplied', () => {
    const filterFunction = vi.fn((value: string, opts: Option[]): Option[] =>
      opts.filter((o) => o.label.startsWith(value)),
    )
    render(<Autocomplete options={options} filterFunction={filterFunction} />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'C' } })
    expect(filterFunction).toHaveBeenCalled()
    expect(screen.getByText('Cherry')).toBeInTheDocument()
    expect(screen.queryByText('Apple')).not.toBeInTheDocument()
  })

  it('calls onChange with the selected item when an option is clicked', () => {
    const onChange = vi.fn()
    render(<Autocomplete options={options} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'B' } })
    fireEvent.click(screen.getByText('Banana'))
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ label: 'Banana', value: 'banana' })
  })

  it('calls onChange with null when the input is cleared', () => {
    const onChange = vi.fn()
    render(<Autocomplete options={options} onChange={onChange} />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'an' } })
    onChange.mockClear()
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('initializes the input from the value prop', () => {
    render(<Autocomplete options={options} value={{ label: 'Apple', value: 'apple' }} />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    expect(input.value).toBe('Apple')
  })

  it('updates the input when the value prop changes', () => {
    const { rerender } = render(
      <Autocomplete options={options} value={{ label: 'Apple', value: 'apple' }} />,
    )
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    expect(input.value).toBe('Apple')
    rerender(<Autocomplete options={options} value={{ label: 'Cherry', value: 'cherry' }} />)
    expect(input.value).toBe('Cherry')
  })

  it('renders with no options without crashing', () => {
    render(<Autocomplete />)
    const input = screen.getByPlaceholderText('Enter a name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'x' } })
    expect(input).toBeInTheDocument()
  })
})
