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
    updateCompanyCrew: jest.fn(),
    addToCompanyList: jest.fn(),
    addToMyList: jest.fn(),
    removeFromCompanyList: jest.fn(() => Promise.resolve()),
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
  companyNickname: null,
  displayName: 'Big Al',
  email: 'ace@example.com',
  serviceAreas: [{ id: 'a1', city: 'Macon', region: 'GA', country: 'US', geocoded: true }],
  packerCount: 1,
  myRating: { stars: 3, comment: 'ok', updatedAt: '2026-10-20T00:00:00.000Z' },
  averageRating: { average: 4.2, count: 5 },
  addedAt: '2026-10-20T00:00:00.000Z',
  inMyList: true,
  inCompanyList: false,
  canRemoveFromCompany: false,
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

  describe('lists', () => {
    // On the company list only: no link of mine, so no rating or private nickname.
    const companyOnly: LaborCrewDetail = {
      ...detail,
      nickname: null,
      companyNickname: 'Ace (Macon)',
      displayName: 'Ace (Macon)',
      myRating: null,
      inMyList: false,
      inCompanyList: true,
    }
    const both: LaborCrewDetail = { ...detail, inCompanyList: true, companyNickname: 'Ace (Macon)' }
    const pressRemove = async () => {
      const alert = (Alert.alert as jest.Mock).mock
      await alert.calls[0]![2]!.find((b: { text: string }) => b.text === 'Remove')!.onPress!()
    }

    beforeEach(() => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    })

    it('offers Add to company list for a crew only in my list, and nothing to remove it', async () => {
      svc.addToCompanyList.mockResolvedValue({ crew: both, outcome: 'addedFromMyList' })
      const { findByText, getByText, queryByText } = render(<CrewScreen />)
      await findByText('Big Al')
      expect(queryByText('Add to my list')).toBeNull()
      expect(queryByText('Remove from company list')).toBeNull()
      fireEvent.press(getByText('Add to company list'))
      await waitFor(() => expect(svc.addToCompanyList).toHaveBeenCalledWith(PHONE))
      expect(await findByText('On the company list as “Ace (Macon)”')).toBeTruthy()
      expect(queryByText('Add to company list')).toBeNull()
    })

    it('shows a company-only crew without rating or Remove from my list, editable by anyone', async () => {
      svc.getCrew.mockResolvedValue(companyOnly)
      const { findByText, getByText, queryByText } = render(<CrewScreen />)
      await findByText('Ace (Macon)')
      expect(queryByText('My rating')).toBeNull()
      expect(queryByText('Remove from my list')).toBeNull()
      expect(queryByText('Remove from company list')).toBeNull()
      expect(getByText('Add to my list')).toBeTruthy()
      expect(getByText('Edit')).toBeTruthy()
      expect(getByText('+ Add packer')).toBeTruthy()
      expect(getByText('Average from 5 drivers: 4.2 ★')).toBeTruthy()
    })

    it('adds a company crew to my list with its shared name', async () => {
      svc.getCrew.mockResolvedValue(companyOnly)
      svc.addToMyList.mockResolvedValue({ ...both, nickname: null, displayName: 'Ace (Macon)' })
      const { findByText, getByText, queryByText } = render(<CrewScreen />)
      await findByText('Ace (Macon)')
      fireEvent.press(getByText('Add to my list'))
      await waitFor(() =>
        expect(svc.addToMyList).toHaveBeenCalledWith({ phone: PHONE, name: 'Ace Movers' }),
      )
      expect(await findByText('My rating')).toBeTruthy()
      expect(queryByText('Add to my list')).toBeNull()
    })

    it('edits a company-only crew through the company route, with no private nickname field', async () => {
      svc.getCrew.mockResolvedValue(companyOnly)
      svc.updateCompanyCrew.mockResolvedValue({ ...companyOnly, companyNickname: 'Ace GA' })
      const { findByText, getByText, getByLabelText, queryByLabelText } = render(<CrewScreen />)
      await findByText('Ace (Macon)')
      fireEvent.press(getByText('Edit'))
      expect(queryByLabelText('My nickname (only you see it)')).toBeNull()
      fireEvent.changeText(
        getByLabelText('Company nickname (everyone at the company sees it)'),
        'Ace GA',
      )
      fireEvent.press(getByText('Save'))
      await waitFor(() =>
        expect(svc.updateCompanyCrew).toHaveBeenCalledWith(PHONE, {
          name: 'Ace Movers',
          email: 'ace@example.com',
          nickname: 'Ace GA',
        }),
      )
      expect(svc.updateCrew).not.toHaveBeenCalled()
    })

    it('saves my nickname and the company nickname for a crew in both lists', async () => {
      svc.getCrew.mockResolvedValue(both)
      svc.updateCrew.mockResolvedValue(both)
      svc.updateCompanyCrew.mockResolvedValue(both)
      const { findByText, getByText, getByLabelText } = render(<CrewScreen />)
      await findByText('Big Al')
      fireEvent.press(getByText('Edit'))
      fireEvent.changeText(
        getByLabelText('Company nickname (everyone at the company sees it)'),
        'Macon Ace',
      )
      fireEvent.press(getByText('Save'))
      await waitFor(() =>
        expect(svc.updateCompanyCrew).toHaveBeenCalledWith(PHONE, { nickname: 'Macon Ace' }),
      )
      expect(svc.updateCrew).toHaveBeenCalledWith(PHONE, {
        name: 'Ace Movers',
        email: 'ace@example.com',
        nickname: 'Big Al',
      })
    })

    it('lets Operations remove from the company list after confirming, staying on a crew in my list', async () => {
      svc.getCrew.mockResolvedValue({ ...both, canRemoveFromCompany: true })
      const { findByText, getByText } = render(<CrewScreen />)
      await findByText('Big Al')
      expect(getByText('Remove from my list')).toBeTruthy()
      fireEvent.press(getByText('Remove from company list'))
      expect(svc.removeFromCompanyList).not.toHaveBeenCalled()
      svc.getCrew.mockResolvedValue({ ...detail })
      await pressRemove()
      expect(svc.removeFromCompanyList).toHaveBeenCalledWith(PHONE)
      expect(router.back).not.toHaveBeenCalled()
      expect(svc.getCrew).toHaveBeenCalledTimes(2)
    })

    it('goes back after Operations remove a company-only crew', async () => {
      svc.getCrew.mockResolvedValue({ ...companyOnly, canRemoveFromCompany: true })
      const { findByText, getByText } = render(<CrewScreen />)
      await findByText('Ace (Macon)')
      fireEvent.press(getByText('Remove from company list'))
      await pressRemove()
      expect(router.back).toHaveBeenCalled()
    })

    it('stays on the card when removing from my list a crew that is also on the company list', async () => {
      svc.getCrew.mockResolvedValue(both)
      const { findByText, getByText } = render(<CrewScreen />)
      await findByText('Big Al')
      fireEvent.press(getByText('Remove from my list'))
      svc.getCrew.mockResolvedValue({ ...companyOnly })
      await pressRemove()
      expect(svc.removeCrew).toHaveBeenCalledWith(PHONE)
      expect(router.back).not.toHaveBeenCalled()
      expect(await findByText('Add to my list')).toBeTruthy()
    })

    it('says what to do when the company list refuses an add', async () => {
      svc.addToCompanyList.mockRejectedValue(
        Object.assign(new Error('Add the crew to your list first'), {
          code: 'CREW_NOT_IN_YOUR_LIST',
        }),
      )
      const { findByText, getByText } = render(<CrewScreen />)
      await findByText('Big Al')
      fireEvent.press(getByText('Add to company list'))
      await waitFor(() =>
        expect(Alert.alert).toHaveBeenCalledWith(
          'Couldn’t add to the company list',
          'Add this crew to your own list first, then put it on the company list from its page.',
        ),
      )
    })
  })
})
