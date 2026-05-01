import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card } from './index'

describe('Card', () => {
  it('renders children content', () => {
    render(<Card>hello world</Card>)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('renders the title node when provided', () => {
    render(<Card title="My title">body</Card>)
    expect(screen.getByText('My title')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('omits visible title text when no title is provided', () => {
    render(<Card>only body</Card>)
    expect(screen.getByText('only body')).toBeInTheDocument()
    expect(screen.queryByText('My title')).not.toBeInTheDocument()
  })

  it('renders a complex ReactNode title', () => {
    render(
      <Card title={<span data-testid="title-node">Custom</span>}>kids</Card>,
    )
    expect(screen.getByTestId('title-node')).toBeInTheDocument()
  })

  it('fires onClick when the card is clicked', () => {
    const onClick = vi.fn()
    render(
      <Card title="t" onClick={onClick}>
        clickable
      </Card>,
    )
    fireEvent.click(screen.getByText('clickable'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies inline style and className', () => {
    const { container } = render(
      <Card className="extra" style={{ width: 100 }}>
        body
      </Card>,
    )
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('extra')
    expect(root.style.width).toBe('100px')
  })

  it('toggles active variant class when active prop changes', () => {
    const { container, rerender } = render(<Card>x</Card>)
    const root = container.firstChild as HTMLElement
    const inactive = root.className
    rerender(<Card active>x</Card>)
    expect((container.firstChild as HTMLElement).className).not.toBe(inactive)
  })
})
