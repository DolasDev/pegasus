import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Expandable } from './Expandable'

describe('Expandable', () => {
  it('renders the title and starts closed (children not visible)', () => {
    render(
      <Expandable title="Section">
        <div data-testid="kid">hidden</div>
      </Expandable>,
    )
    expect(screen.getByText('Section')).toBeInTheDocument()
    expect(screen.queryByTestId('kid')).not.toBeInTheDocument()
  })

  it('opens to reveal children when the title is clicked', () => {
    render(
      <Expandable title="Section">
        <div data-testid="kid">visible</div>
      </Expandable>,
    )
    fireEvent.click(screen.getByText('Section'))
    expect(screen.getByTestId('kid')).toBeInTheDocument()
  })

  it('toggles closed again on a second click', () => {
    render(
      <Expandable title="Section">
        <div data-testid="kid">x</div>
      </Expandable>,
    )
    const titleEl = screen.getByText('Section')
    fireEvent.click(titleEl)
    expect(screen.getByTestId('kid')).toBeInTheDocument()
    fireEvent.click(titleEl)
    expect(screen.queryByTestId('kid')).not.toBeInTheDocument()
  })

  it('accepts a ReactNode title', () => {
    render(
      <Expandable title={<span data-testid="title-node">Hi</span>}>
        <div>body</div>
      </Expandable>,
    )
    expect(screen.getByTestId('title-node')).toBeInTheDocument()
  })

  it('rotates the caret class when opened', () => {
    const { container } = render(
      <Expandable title="Section">
        <div>body</div>
      </Expandable>,
    )
    const caret = container.querySelector('i') as HTMLElement
    const closedClass = caret.className
    fireEvent.click(screen.getByText('Section'))
    const openedClass = (container.querySelector('i') as HTMLElement).className
    expect(openedClass).not.toBe(closedClass)
  })
})
