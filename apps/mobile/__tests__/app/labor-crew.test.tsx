import React from 'react'
import { Alert, Linking } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import CrewScreen from '../../app/labor/[phone]'
import { LaborService } from '../../src/services/laborService'
import type { LaborCrewDetail } from '../../src/types/labor'

jest.mock('../../src/services/laborService', () => ({
  LaborService: {
    getCrew: jest.fn(),
    updateCrew: jest.fn(),
    removeCrew: jest.fn(() => Promise.resolve()),
    setServiceAreas: jest.fn(),
    deletePacker: jest.fn(() => Promise.resolve()),
    rateCrew: jest.fn(),
    clearRating: jest.fn(),
    searchPlaces: jest.fn(() => Promise.resolve([])),
  },
}))

const svc = LaborService as jest.Mocked<typeof LaborService>
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() }
const PHONE = '+14045550101'

const detail: LaborCrewDetail = {
  phone: PHONE,
  phoneDisplay: '(404) 555-0101',
  name: 'Ace Movers',
  nickname: 'Big Al',
  displayName: 'Big Al',
  email: 'ace@example.com',
  serviceAreas: [{ id: 'a1', city: 'Macon', region: 'GA', country: 'US', geocoded: true }],
  packerCount: 1,
  myRating: { stars: 3, comment: 'ok', updatedAt: '2026-10-20T00:00:00.000Z' },
  averageRating: { average: 4.2, count: 5 },
  addedAt: '2026-10-20T00:00:00.000Z',
  packers: [
    {
      id: 'p1',
      firstName: 'Pat',
      lastName: 'Lee',
      email: null,
      cidNumber: 'C123',
      cidIssuedOn: '2024-03-01',
      phone: null,
      phoneDisplay: null,
      updatedAt: '2026-10-20T00:00:00.000Z',
    },
  ],
}

beforeEach(() => {
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ phone: PHONE })
  ;(useRouter as jest.Mock).mockReturnValue(router)
  svc.getCrew.mockResolvedValue(detail)
})

describe('CrewScreen', () => {
  it('shows the header, areas, my rating, the average and the packers', async () => {
    const { findByText, getByText } = render(<CrewScreen />)
    expect(await findByText('Big Al')).toBeTruthy()
    expect(svc.getCrew).toHaveBeenCalledWith(PHONE)
    expect(getByText('Crew name: Ace Movers')).toBeTruthy()
    expect(getByText('(404) 555-0101')).toBeTruthy()
    expect(getByText('Macon, GA')).toBeTruthy()
    expect(getByText('Average from 5 drivers: 4.2 ★')).toBeTruthy()
    expect(getByText('Pat Lee')).toBeTruthy()
    expect(getByText('CID C123 · issued 2024-03-01')).toBeTruthy()
    expect(getByText('Packers (1)')).toBeTruthy()
  })

  it('calls and texts the crew', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const { findByText, getByText } = render(<CrewScreen />)
    await findByText('Big Al')
    fireEvent.press(getByText('Call'))
    fireEvent.press(getByText('Text'))
    expect(open).toHaveBeenCalledWith(`tel:${PHONE}`)
    expect(open).toHaveBeenCalledWith(`sms:${PHONE}`)
  })

  it('saves a new rating and comment', async () => {
    svc.rateCrew.mockResolvedValue({
      ...detail,
      myRating: { stars: 5, comment: 'great', updatedAt: '' },
    })
    const { findByText, getByLabelText, getByText, queryByText } = render(<CrewScreen />)
    await findByText('Big Al')
    expect(queryByText('Save rating')).toBeNull()
    fireEvent.press(getByLabelText('5 stars'))
    fireEvent.changeText(getByLabelText('Rating comment'), 'great')
    fireEvent.press(getByText('Save rating'))
    await waitFor(() =>
      expect(svc.rateCrew).toHaveBeenCalledWith(PHONE, { stars: 5, comment: 'great' }),
    )
    await waitFor(() => expect(queryByText('Save rating')).toBeNull())
  })

  it('clears my rating by tapping the current star', async () => {
    svc.clearRating.mockResolvedValue({ ...detail, myRating: null })
    const { findByText, getByLabelText, getByText } = render(<CrewScreen />)
    await findByText('Big Al')
    fireEvent.press(getByLabelText('3 stars'))
    fireEvent.press(getByText('Clear rating'))
    await waitFor(() => expect(svc.clearRating).toHaveBeenCalledWith(PHONE))
  })

  it('edits the shared name and my nickname', async () => {
    svc.updateCrew.mockResolvedValue({
      ...detail,
      name: 'Ace Labor',
      nickname: null,
      displayName: 'Ace Labor',
    })
    const { findByText, getByText, getByLabelText } = render(<CrewScreen />)
    await findByText('Big Al')
    fireEvent.press(getByText('Edit'))
    fireEvent.changeText(getByLabelText('Crew name (shared)'), 'Ace Labor')
    fireEvent.changeText(getByLabelText('My nickname (only you see it)'), '  ')
    fireEvent.press(getByText('Save'))
    await waitFor(() =>
      expect(svc.updateCrew).toHaveBeenCalledWith(PHONE, {
        name: 'Ace Labor',
        email: 'ace@example.com',
        nickname: null,
      }),
    )
    expect(await findByText('Ace Labor')).toBeTruthy()
  })

  it('removes a service area', async () => {
    svc.setServiceAreas.mockResolvedValue({ ...detail, serviceAreas: [] })
    const { findByLabelText, findByText } = render(<CrewScreen />)
    fireEvent.press(await findByLabelText('Remove Macon, GA'))
    await waitFor(() => expect(svc.setServiceAreas).toHaveBeenCalledWith(PHONE, []))
    expect(await findByText('No service areas yet')).toBeTruthy()
  })

  it('opens the packer form to add and to edit', async () => {
    const { findByText, getByText, getByLabelText } = render(<CrewScreen />)
    await findByText('Big Al')
    fireEvent.press(getByText('+ Add packer'))
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/labor/packer',
      params: { phone: PHONE },
    })
    fireEvent.press(getByLabelText('Packer Pat Lee'))
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/labor/packer',
      params: { phone: PHONE, id: 'p1' },
    })
  })

  it('deletes a packer after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByLabelText } = render(<CrewScreen />)
    fireEvent(await findByLabelText('Packer Pat Lee'), 'longPress')
    const del = alert.mock.calls[0]![2]!.find((b) => b.text === 'Delete')!
    del.onPress!()
    await waitFor(() => expect(svc.deletePacker).toHaveBeenCalledWith(PHONE, 'p1'))
  })

  it('removes the crew from my list after confirming, then goes back', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByText, getByText } = render(<CrewScreen />)
    await findByText('Big Al')
    fireEvent.press(getByText('Remove from my list'))
    const remove = alert.mock.calls[0]![2]!.find((b) => b.text === 'Remove')!
    await remove.onPress!()
    expect(svc.removeCrew).toHaveBeenCalledWith(PHONE)
    expect(router.back).toHaveBeenCalled()
  })

  it('shows an error when the crew is not in my list', async () => {
    svc.getCrew.mockRejectedValueOnce(new Error('Crew not in your list'))
    const { findByText } = render(<CrewScreen />)
    expect(await findByText('Crew not in your list')).toBeTruthy()
  })
})
