import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { DeliveryEtaCard } from '../DeliveryEtaCard'
import type { LonghaulActivity } from '../../types/longhaul'

const activity = {
  id: 5,
  order_num: 491615,
  activityType_code: 'RDEL',
  activityType_name: 'Delivery',
  activityType_isHasETA: true,
  estimated_date: '2026-11-02',
  planned_start: '2026-11-01',
  planned_end: '2026-11-03',
  actual_date: null,
} as unknown as LonghaulActivity

describe('DeliveryEtaCard', () => {
  it('opens the editor when the driver may submit ETAs', () => {
    const onPress = jest.fn()
    const { getByText } = render(<DeliveryEtaCard activity={activity} onPress={onPress} />)
    fireEvent.press(getByText('Set ETA ›'))
    expect(onPress).toHaveBeenCalled()
  })

  it('is read-only without onPress (tenant has driver ETAs off) but still shows the ETA', () => {
    const { queryByText, getByText } = render(<DeliveryEtaCard activity={activity} />)
    expect(queryByText('Set ETA ›')).toBeNull()
    expect(getByText(/^ETA:/)).toBeTruthy()
  })
})
