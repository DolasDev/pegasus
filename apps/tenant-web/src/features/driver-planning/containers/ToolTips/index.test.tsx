import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import { HoverToolTip } from './index'

describe('HoverToolTip', () => {
  it('renders children', () => {
    render(
      <HoverToolTip content="hello">
        <span>kids</span>
      </HoverToolTip>,
    )
    expect(screen.getByText('kids')).toBeInTheDocument()
  })

  it('does not show tooltip content by default', () => {
    render(
      <HoverToolTip content="popup-text">
        <span>kids</span>
      </HoverToolTip>,
    )
    expect(screen.queryByText('popup-text')).not.toBeInTheDocument()
  })

  it('reveals content after hover delay and hides on mouse leave', () => {
    vi.useFakeTimers()
    try {
      render(
        <HoverToolTip content="popup-text" delay={100}>
          <span data-testid="hover-target">kids</span>
        </HoverToolTip>,
      )
      const target = screen.getByTestId('hover-target').parentElement!
      fireEvent.mouseEnter(target)
      act(() => {
        vi.advanceTimersByTime(150)
      })
      expect(screen.getByText('popup-text')).toBeInTheDocument()
      fireEvent.mouseLeave(target)
      expect(screen.queryByText('popup-text')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
