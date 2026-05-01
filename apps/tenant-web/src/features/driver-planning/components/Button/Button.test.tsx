import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button, CircularButton, IconButton } from './index'

describe('Button', () => {
  it('renders children inside a button element', () => {
    render(<Button>Click me</Button>)
    const btn = screen.getByRole('button', { name: 'Click me' })
    expect(btn).toBeInTheDocument()
    expect(btn.tagName).toBe('BUTTON')
  })

  it('fires onClick when clicked', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies inverted variant class when inverted prop is true', () => {
    const { rerender } = render(<Button inverted>Inv</Button>)
    const inverted = screen.getByRole('button', { name: 'Inv' }).className
    rerender(<Button inverted={false}>Inv</Button>)
    const baseline = screen.getByRole('button', { name: 'Inv' }).className
    expect(inverted).not.toBe(baseline)
  })

  it('appends custom className', () => {
    render(<Button className="my-extra">Hi</Button>)
    expect(screen.getByRole('button', { name: 'Hi' }).className).toContain('my-extra')
  })

  it('forwards arbitrary props to the underlying button (e.g. type, disabled)', () => {
    render(
      <Button type="submit" disabled data-testid="submitter">
        Submit
      </Button>,
    )
    const btn = screen.getByTestId('submitter') as HTMLButtonElement
    expect(btn.type).toBe('submit')
    expect(btn.disabled).toBe(true)
  })

  it('forwards refs to the underlying button element', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(<Button ref={ref as unknown as React.Ref<unknown>}>Ref</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('applies a color-keyed class when color prop matches a CSS module key', () => {
    render(<Button color="inverted">Colored</Button>)
    expect(screen.getByRole('button', { name: 'Colored' }).className.length).toBeGreaterThan(0)
  })
})

describe('CircularButton', () => {
  it('renders a button and forwards children/onClick', () => {
    const onClick = vi.fn()
    render(<CircularButton onClick={onClick}>O</CircularButton>)
    const btn = screen.getByRole('button', { name: 'O' })
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalled()
  })
})

describe('IconButton', () => {
  it('renders the provided Icon node and fires onClick', () => {
    const onClick = vi.fn()
    render(
      <IconButton
        Icon={<span data-testid="icon">★</span>}
        onClick={onClick}
        aria-label="star"
      />,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'star' }))
    expect(onClick).toHaveBeenCalled()
  })
})
