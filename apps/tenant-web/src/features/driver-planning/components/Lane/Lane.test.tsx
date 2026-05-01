import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Lane } from './index'

describe('Lane', () => {
  it('renders the title inside an h5', () => {
    render(<Lane title="Today" />)
    const heading = screen.getByText('Today')
    expect(heading.tagName).toBe('H5')
  })

  it('renders children alongside the title', () => {
    render(
      <Lane title="Today">
        <div data-testid="kid">item</div>
      </Lane>,
    )
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByTestId('kid')).toBeInTheDocument()
  })

  it('renders without a title prop without crashing', () => {
    const { container } = render(<Lane>plain</Lane>)
    expect(container).toBeTruthy()
    expect(screen.getByText('plain')).toBeInTheDocument()
  })

  it('applies a custom className on the wrapper', () => {
    const { container } = render(<Lane className="extra-lane">x</Lane>)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('extra-lane')
  })

  it('accepts a ReactNode title', () => {
    render(<Lane title={<span data-testid="tn">Hi</span>}>x</Lane>)
    expect(screen.getByTestId('tn')).toBeInTheDocument()
  })
})
