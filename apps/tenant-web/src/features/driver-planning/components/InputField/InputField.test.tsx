import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InputField } from './index'

describe('InputField', () => {
  it('renders an input element', () => {
    render(<InputField placeholder="type here" />)
    const input = screen.getByPlaceholderText('type here') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
  })

  it('respects controlled value and onChange', () => {
    const onChange = vi.fn()
    render(<InputField value="abc" onChange={onChange} data-testid="ctrl" />)
    const input = screen.getByTestId('ctrl') as HTMLInputElement
    expect(input.value).toBe('abc')
    fireEvent.change(input, { target: { value: 'xyz' } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('updates as a controlled input wired through React state', () => {
    function Harness() {
      const [v, setV] = useState('')
      return (
        <InputField
          data-testid="harness"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      )
    }
    render(<Harness />)
    const input = screen.getByTestId('harness') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    expect(input.value).toBe('hello')
  })

  it('supports uncontrolled usage with defaultValue', () => {
    render(<InputField defaultValue="seed" data-testid="uc" />)
    const input = screen.getByTestId('uc') as HTMLInputElement
    expect(input.value).toBe('seed')
    fireEvent.change(input, { target: { value: 'changed' } })
    expect(input.value).toBe('changed')
  })

  it('forwards arbitrary props (type, disabled, name) to the input', () => {
    render(
      <InputField
        type="email"
        name="email"
        disabled
        data-testid="forwarded"
      />,
    )
    const input = screen.getByTestId('forwarded') as HTMLInputElement
    expect(input.type).toBe('email')
    expect(input.name).toBe('email')
    expect(input.disabled).toBe(true)
  })

  it('applies custom className alongside its base class', () => {
    render(<InputField className="extra-cls" data-testid="cls" />)
    const input = screen.getByTestId('cls') as HTMLInputElement
    expect(input.className).toContain('extra-cls')
  })
})
