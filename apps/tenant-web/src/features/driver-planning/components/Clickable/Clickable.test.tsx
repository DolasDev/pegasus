import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Clickable } from './index'

describe('Clickable', () => {
  it('renders the value as content', () => {
    render(<Clickable value="Press" />)
    expect(screen.getByText('Press')).toBeInTheDocument()
  })

  it('renders a ReactNode value', () => {
    render(<Clickable value={<span data-testid="inner">x</span>} />)
    expect(screen.getByTestId('inner')).toBeInTheDocument()
  })

  it('fires onClick when clicked', () => {
    const onClick = vi.fn()
    render(<Clickable value="Press" onClick={onClick} />)
    fireEvent.click(screen.getByText('Press'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies className and inline style', () => {
    const { container } = render(
      <Clickable value="v" className="extra-class" style={{ color: 'red' }} />,
    )
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('extra-class')
    expect(root.style.color).toBe('red')
  })

  it('renders without an onClick handler safely', () => {
    const { container } = render(<Clickable value="no-handler" />)
    fireEvent.click(container.firstChild as HTMLElement)
    expect(screen.getByText('no-handler')).toBeInTheDocument()
  })
})
