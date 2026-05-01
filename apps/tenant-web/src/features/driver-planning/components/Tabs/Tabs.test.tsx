import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tabs } from './index'

describe('Tabs', () => {
  it('renders all provided tab labels', () => {
    render(<Tabs tabs={['One', 'Two', 'Three']} selectedTabIndex={0} onTabClick={() => {}} />)
    expect(screen.getByText('One')).toBeInTheDocument()
    expect(screen.getByText('Two')).toBeInTheDocument()
    expect(screen.getByText('Three')).toBeInTheDocument()
  })

  it('marks the selected tab with a different className than unselected tabs', () => {
    render(<Tabs tabs={['A', 'B']} selectedTabIndex={1} onTabClick={() => {}} />)
    const a = screen.getByText('A')
    const b = screen.getByText('B')
    expect(b.className).not.toBe(a.className)
    // Selected tab's class should be a superset (longer) than the unselected one
    expect(b.className.length).toBeGreaterThan(a.className.length)
  })

  it('calls onTabClick with the clicked index', () => {
    const onTabClick = vi.fn()
    render(<Tabs tabs={['A', 'B', 'C']} selectedTabIndex={0} onTabClick={onTabClick} />)
    fireEvent.click(screen.getByText('C'))
    expect(onTabClick).toHaveBeenCalledTimes(1)
    expect(onTabClick).toHaveBeenCalledWith(2)
  })

  it('updates which tab is highlighted when selectedTabIndex changes (via rerender)', () => {
    const { rerender } = render(
      <Tabs tabs={['A', 'B']} selectedTabIndex={0} onTabClick={() => {}} />,
    )
    const aSelected = screen.getByText('A').className
    const bUnselected = screen.getByText('B').className
    rerender(<Tabs tabs={['A', 'B']} selectedTabIndex={1} onTabClick={() => {}} />)
    const aUnselected = screen.getByText('A').className
    const bSelected = screen.getByText('B').className
    expect(aSelected).not.toBe(aUnselected)
    expect(bUnselected).not.toBe(bSelected)
  })

  it('renders nothing when tabs is omitted (defaults to empty array)', () => {
    const { container } = render(<Tabs onTabClick={() => {}} />)
    // The container <div> should be empty
    expect(container.firstChild?.childNodes.length).toBe(0)
  })
})
