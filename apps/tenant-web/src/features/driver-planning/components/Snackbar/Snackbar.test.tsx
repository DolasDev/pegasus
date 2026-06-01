import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Snackbar } from './index'

describe('Snackbar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the message when open=true', () => {
    render(<Snackbar open={true} message="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders nothing when open=false (initial mount, no prior state)', () => {
    const { container } = render(<Snackbar open={false} message="Hidden" />)
    // open is false and isOpen initial state is also false => returns nothing
    expect(container.firstChild).toBeNull()
  })

  it('renders as a div with a non-empty className when a `type` prop is provided', () => {
    const { container } = render(<Snackbar open={true} message="m" type="success" />)
    const root = container.firstChild as HTMLElement
    expect(root.tagName).toBe('DIV')
    expect(root.className.trim().length).toBeGreaterThan(0)
  })

  it('appends a custom className', () => {
    const { container } = render(<Snackbar open={true} message="m" className="my-extra" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('my-extra')
  })

  it('invokes onClose after autoHideDuration when open=true', () => {
    const onClose = vi.fn()
    render(<Snackbar open={true} message="bye" autoHideDuration={1000} onClose={onClose} />)
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses the default autoHideDuration of 3000ms when not provided', () => {
    const onClose = vi.fn()
    render(<Snackbar open={true} message="bye" onClose={onClose} />)
    vi.advanceTimersByTime(2999)
    expect(onClose).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not render the literal string "undefined" in className when type prop is omitted', () => {
    const { container } = render(<Snackbar open={true} message="hi" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).not.toContain('undefined')
  })

  it('does not render the literal string "undefined" in className when type prop is an unknown value', () => {
    const { container } = render(<Snackbar open={true} message="hi" type="warning" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).not.toContain('undefined')
  })

  it('does not stack autohide timers across re-renders while open', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Snackbar open={true} message="hi" autoHideDuration={1000} onClose={onClose} />,
    )
    // multiple re-renders while open — the old buggy code would queue a new timer each time
    rerender(<Snackbar open={true} message="hi" autoHideDuration={1000} onClose={onClose} />)
    rerender(<Snackbar open={true} message="hi" autoHideDuration={1000} onClose={onClose} />)
    vi.advanceTimersByTime(1000)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
