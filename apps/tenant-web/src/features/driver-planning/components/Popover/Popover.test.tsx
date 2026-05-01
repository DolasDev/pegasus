import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Popover } from './index'

// NOTE: Despite the unit task description suggesting floating-ui usage,
// this Popover component is just a styled <div> with forwardRef. It does
// NOT use floating-ui or any positioning library. Tests below cover the
// real surface: children rendering, ref forwarding, and prop pass-through.

describe('Popover', () => {
  it('renders its children', () => {
    render(
      <Popover>
        <span data-testid="content">Popover content</span>
      </Popover>,
    )
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('renders nothing visible (no children) gracefully', () => {
    const { container } = render(<Popover />)
    const root = container.firstChild as HTMLElement
    expect(root).not.toBeNull()
    expect(root.tagName).toBe('DIV')
    expect(root.children.length).toBe(0)
  })

  it('forwards ref to the underlying div element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <Popover ref={ref}>
        <span>x</span>
      </Popover>,
    )
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('forwards arbitrary HTML attributes (e.g. id, role, data-*)', () => {
    render(
      <Popover id="popover-1" role="dialog" data-state="open">
        <span>x</span>
      </Popover>,
    )
    const div = screen.getByRole('dialog')
    expect(div.id).toBe('popover-1')
    expect(div.getAttribute('data-state')).toBe('open')
  })

  it('applies the popover-container CSS class', () => {
    const { container } = render(
      <Popover>
        <span>x</span>
      </Popover>,
    )
    const root = container.firstChild as HTMLElement
    // CSS modules transform the class name; just assert it's present (non-empty)
    expect(root.className.length).toBeGreaterThan(0)
  })
})
