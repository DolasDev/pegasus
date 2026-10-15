import React from 'react'
import { render } from '@testing-library/react-native'
import { MetricCard } from '../MetricCard'

describe('MetricCard', () => {
  it('renders label and value', () => {
    const { getByText } = render(<MetricCard label="Active" value="42" />)
    expect(getByText('Active')).toBeTruthy()
    expect(getByText('42')).toBeTruthy()
  })

  it('renders optional subtitle when provided', () => {
    const { getByText, queryByText, rerender } = render(
      <MetricCard label="Balance" value="$1,000" subtitle="Available" />,
    )
    expect(getByText('Available')).toBeTruthy()

    rerender(<MetricCard label="Balance" value="$1,000" />)
    expect(queryByText('Available')).toBeNull()
  })

  it('renders extra subtitle lines', () => {
    const { getByText } = render(
      <MetricCard
        label="Balance"
        value="$1"
        subtitle="Available"
        subtitleLines={['Line A', 'Line B']}
      />,
    )
    expect(getByText('Available')).toBeTruthy()
    expect(getByText('Line A')).toBeTruthy()
    expect(getByText('Line B')).toBeTruthy()
  })
})
