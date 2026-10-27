import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { ItineraryItemDetail } from '../ItineraryItemDetail'
import type { ItineraryItem } from '../../types/itinerary'

function localItem(partial: Partial<ItineraryItem>): ItineraryItem {
  return {
    key: 'local-job-token:9:MILE',
    source: { kind: 'local-job-token', jobId: 9, token: 'MILE' },
    orderNum: 200,
    shipperName: 'Jones',
    actCode: 'MILE',
    actName: 'MILE',
    known: false,
    kind: 'act',
    side: 'neither',
    place: null,
    placeNote: null,
    day: '2026-10-27',
    plannedStart: '2026-10-27',
    plannedEnd: null,
    estimated: null,
    actual: null,
    arrivalWindow: null,
    committed: false,
    confirmed: false,
    sequence: 999,
    tripId: null,
    tripStatus: null,
    drivers: { longhaul: [], local: [12] },
    ...partial,
  }
}

describe('ItineraryItemDetail', () => {
  it('renders nothing visible without an item', () => {
    const { queryByText } = render(<ItineraryItemDetail item={null} onClose={jest.fn()} />)
    expect(queryByText('Local job')).toBeNull()
  })

  it('explains a hand-typed code and shows a place-less job as "—"', () => {
    const { getByText, getAllByText } = render(
      <ItineraryItemDetail item={localItem({})} onClose={jest.fn()} />,
    )
    expect(getByText(/“MILE” was typed in by the dispatcher/)).toBeTruthy()
    expect(getByText('#200')).toBeTruthy()
    expect(getByText('Tue Oct 27')).toBeTruthy()
    expect(getAllByText('—').length).toBeGreaterThan(0)
    expect(getByText('Scheduled')).toBeTruthy()
  })

  it('shows the address, window and done status of a known act', () => {
    const { getByText, queryByText } = render(
      <ItineraryItemDetail
        item={localItem({
          actCode: 'PACK',
          actName: 'Pack',
          known: true,
          place: { street: '1 Elm St', unit: null, city: 'Austin', state: 'TX', zip: '78701' },
          arrivalWindow: { start: '08:00', end: '10:00', tz: null },
          actual: '2026-10-27',
        })}
        onClose={jest.fn()}
      />,
    )
    expect(queryByText(/typed in by the dispatcher/)).toBeNull()
    expect(getByText('1 Elm St\nAustin, TX 78701')).toBeTruthy()
    expect(getByText('08:00 – 10:00')).toBeTruthy()
    expect(getByText('Done')).toBeTruthy()
  })

  it('closes', () => {
    const onClose = jest.fn()
    const { getByText } = render(<ItineraryItemDetail item={localItem({})} onClose={onClose} />)
    fireEvent.press(getByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})
