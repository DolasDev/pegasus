import React from 'react'
import { Alert } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { useRouter } from 'expo-router'
import LaborScreen, { sectionsByInitial } from '../../../app/(drawer)/labor'
import { LaborService } from '../../../src/services/laborService'
import { exportLaborList } from '../../../src/services/laborExport'
import { useLaborAccess, type LaborAccess } from '../../../src/auth/laborAccess'
import type { LaborCrew } from '../../../src/types/labor'

jest.mock('../../../src/services/laborService', () => ({
  LaborService: {
    searchCrews: jest.fn(),
    searchCompanyCrews: jest.fn(),
    getMyCrew: jest.fn(),
    updateMyCrewMember: jest.fn(),
  },
}))
jest.mock('../../../src/auth/laborAccess', () => ({ useLaborAccess: jest.fn() }))
jest.mock('../../../src/services/laborExport', () => ({
  exportLaborList: jest.fn(() => Promise.resolve(1)),
}))

const searchCrews = LaborService.searchCrews as jest.Mock
const searchCompanyCrews = LaborService.searchCompanyCrews as jest.Mock
const getMyCrew = LaborService.getMyCrew as jest.Mock
const updateMyCrewMember = LaborService.updateMyCrewMember as jest.Mock
const access = useLaborAccess as jest.Mock

const DRIVER: LaborAccess = {
  isDriver: true,
  isOperations: false,
  resolved: true,
  pending: false,
  canSeeLabor: true,
  operationsOnly: false,
}
const DRIVER_OPS: LaborAccess = { ...DRIVER, isOperations: true }
const OPS_ONLY: LaborAccess = {
  ...DRIVER,
  isDriver: false,
  isOperations: true,
  operationsOnly: true,
}
const push = jest.fn()

function crew(partial: Partial<LaborCrew>): LaborCrew {
  return {
    phone: '+14045550101',
    phoneDisplay: '(404) 555-0101',
    name: 'Ace Movers',
    nickname: null,
    companyNickname: null,
    displayName: 'Ace Movers',
    email: null,
    serviceAreas: [],
    packerCount: 0,
    myRating: null,
    averageRating: null,
    addedAt: '2026-10-20T00:00:00.000Z',
    inMyList: true,
    inCompanyList: false,
    canRemoveFromCompany: false,
    ...partial,
  }
}

const ace = crew({
  serviceAreas: [{ id: 'a1', city: 'Macon', region: 'GA', country: 'US', geocoded: true }],
  packerCount: 2,
  myRating: { stars: 4, comment: null, updatedAt: '2026-10-20T00:00:00.000Z' },
  averageRating: { average: 3.7, count: 3 },
})
const bob = crew({ phone: '+14045550102', name: 'Bob Crew', displayName: 'Bob Crew' })

// A search lands after the 300 ms debounce plus a render; under a loaded CI
// runner that overruns findBy's 1 s default, so searches get more room.
const AFTER_DEBOUNCE = { timeout: 5000 }

beforeEach(() => {
  access.mockReturnValue(DRIVER)
  ;(useRouter as jest.Mock).mockReturnValue({ push, replace: jest.fn(), back: jest.fn() })
})

describe('sectionsByInitial', () => {
  it('groups by the accent-folded initial, with non-letters last under #', () => {
    const sections = sectionsByInitial([
      crew({ displayName: 'Émile' }),
      crew({ displayName: '24/7 Labor' }),
      crew({ displayName: 'apex' }),
      crew({ displayName: 'Eagle' }),
    ])
    expect(sections.map((s) => [s.title, s.data.map((c) => c.displayName)])).toEqual([
      ['A', ['apex']],
      ['E', ['Émile', 'Eagle']],
      ['#', ['24/7 Labor']],
    ])
  })
})

describe('LaborScreen', () => {
  it('lists my crews A–Z with my stars, the average and packer count', async () => {
    searchCrews.mockResolvedValue({ crews: [ace, bob], location: null, locationNotFound: false })
    const { findByText, getByText, getByLabelText } = render(<LaborScreen />)
    expect(await findByText('Ace Movers')).toBeTruthy()
    expect(searchCrews).toHaveBeenCalledWith('')
    expect(getByText('A')).toBeTruthy()
    expect(getByText('B')).toBeTruthy()
    expect(getByText('Macon, GA')).toBeTruthy()
    expect(getByText('avg 3.7 (3)')).toBeTruthy()
    expect(getByText('2 packers')).toBeTruthy()
    expect(getByLabelText('4 out of 5 stars')).toBeTruthy()
    expect(getByLabelText('Not rated')).toBeTruthy()
  })

  it('searches a ZIP and shows nearest first with distances', async () => {
    searchCrews.mockResolvedValueOnce({
      crews: [ace, bob],
      location: null,
      locationNotFound: false,
    })
    searchCrews.mockResolvedValueOnce({
      crews: [
        { ...ace, distanceMiles: 3.24 },
        { ...bob, distanceMiles: null },
      ],
      location: { lat: 32.8, lon: -83.6, label: '31201 (GA)' },
      locationNotFound: false,
    })
    const { findByText, getByLabelText, getByText, queryByText } = render(<LaborScreen />)
    await findByText('Ace Movers')
    fireEvent.changeText(getByLabelText('ZIP, city, state, name or phone'), '31201')
    expect(await findByText('Nearest to 31201 (GA)', {}, AFTER_DEBOUNCE)).toBeTruthy()
    expect(searchCrews).toHaveBeenLastCalledWith('31201')
    expect(getByText('3.2 mi')).toBeTruthy()
    // a flat list, not A–Z sections
    expect(queryByText('A')).toBeNull()
  })

  it('says when a location is unknown', async () => {
    searchCrews.mockResolvedValueOnce({ crews: [ace], location: null, locationNotFound: false })
    searchCrews.mockResolvedValueOnce({ crews: [], location: null, locationNotFound: true })
    const { findByText, getByLabelText } = render(<LaborScreen />)
    await findByText('Ace Movers')
    fireEvent.changeText(getByLabelText('ZIP, city, state, name or phone'), '00000')
    expect(await findByText('Location not found', {}, AFTER_DEBOUNCE)).toBeTruthy()
  })

  it('shows the empty state, and Add Crew offers contacts or manual entry', async () => {
    searchCrews.mockResolvedValue({ crews: [], location: null, locationNotFound: false })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByText, getByText } = render(<LaborScreen />)
    expect(await findByText('No crews yet')).toBeTruthy()

    fireEvent.press(getByText('+ Add Crew'))
    const buttons = alert.mock.calls[0]![2]!
    expect(buttons.map((b) => b.text)).toEqual(['From contacts', 'Enter manually', 'Cancel'])
    buttons[0]!.onPress!()
    expect(push).toHaveBeenCalledWith('/labor/import')
    buttons[1]!.onPress!()
    expect(push).toHaveBeenCalledWith('/labor/new')
  })

  it('exports as a contacts file', async () => {
    searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByText, getByText } = render(<LaborScreen />)
    await findByText('Ace Movers')
    fireEvent.press(getByText('Export'))
    const buttons = alert.mock.calls[0]![2]!
    expect(buttons.map((b) => b.text)).toEqual([
      'Contacts file (.vcf)',
      'Spreadsheet (.csv)',
      'Cancel',
    ])
    buttons[0]!.onPress!()
    await waitFor(() => expect(exportLaborList).toHaveBeenCalledWith('vcf'))
  })

  it('reports a failed export', async () => {
    searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
    ;(exportLaborList as jest.Mock).mockRejectedValueOnce(new Error('Your Labor list is empty'))
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByText, getByText } = render(<LaborScreen />)
    await findByText('Ace Movers')
    fireEvent.press(getByText('Export'))
    alert.mock.calls[0]![2]![1]!.onPress!()
    await waitFor(() =>
      expect(alert).toHaveBeenLastCalledWith('Export failed', 'Your Labor list is empty'),
    )
  })

  it('opens a crew', async () => {
    searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
    const { findByLabelText } = render(<LaborScreen />)
    fireEvent.press(await findByLabelText('Crew Ace Movers'))
    expect(push).toHaveBeenCalledWith({
      pathname: '/labor/[phone]',
      params: { phone: '+14045550101' },
    })
  })

  it('shows a load error with Retry', async () => {
    searchCrews.mockRejectedValueOnce(new Error('Network request failed'))
    searchCrews.mockResolvedValueOnce({ crews: [ace], location: null, locationNotFound: false })
    const { findByText, getByText } = render(<LaborScreen />)
    expect(await findByText('Network request failed')).toBeTruthy()
    fireEvent.press(getByText('Retry'))
    expect(await findByText('Ace Movers')).toBeTruthy()
  })

  describe('Company segment', () => {
    const shared = crew({
      phone: '+14045550103',
      name: 'Cy Crew',
      displayName: 'Cy Crew',
      inMyList: false,
      inCompanyList: true,
      canRemoveFromCompany: false,
      myRating: null,
    })

    it('shows My list | Company to a driver, defaulting to My list', async () => {
      searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
      const { findByText, getByLabelText } = render(<LaborScreen />)
      await findByText('Ace Movers')
      expect(getByLabelText('My list')).toBeTruthy()
      expect(getByLabelText('Company')).toBeTruthy()
      expect(searchCompanyCrews).not.toHaveBeenCalled()
    })

    it('switches to the company list: no Export, no Add Crew for a plain driver, no stars', async () => {
      searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
      searchCompanyCrews.mockResolvedValue({
        crews: [shared],
        location: null,
        locationNotFound: false,
      })
      const { findByText, getByLabelText, queryByText, queryByLabelText } = render(<LaborScreen />)
      await findByText('Ace Movers')
      expect(queryByText('Export')).toBeTruthy()

      fireEvent.press(getByLabelText('Company'))
      expect(await findByText('Cy Crew')).toBeTruthy()
      expect(searchCompanyCrews).toHaveBeenCalledWith('')
      expect(queryByText('Ace Movers')).toBeNull()
      expect(queryByText('Export')).toBeNull()
      expect(queryByText('+ Add Crew')).toBeNull()
      // not in my list: no stars of mine on the card
      expect(queryByLabelText('Not rated')).toBeNull()
    })

    it('lets Operations add a crew straight onto the company list', async () => {
      access.mockReturnValue(DRIVER_OPS)
      searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
      searchCompanyCrews.mockResolvedValue({
        crews: [shared],
        location: null,
        locationNotFound: false,
      })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
      const { findByText, getByLabelText, getByText, queryByText } = render(<LaborScreen />)
      await findByText('Ace Movers')
      fireEvent.press(getByLabelText('Company'))
      await findByText('Cy Crew')
      expect(queryByText('Export')).toBeNull()
      fireEvent.press(getByText('+ Add Crew'))
      expect(alert).not.toHaveBeenCalled()
      expect(push).toHaveBeenCalledWith({ pathname: '/labor/new', params: { scope: 'company' } })
    })

    it('shows an Operations-only user just the company list, with no segments', async () => {
      access.mockReturnValue(OPS_ONLY)
      searchCompanyCrews.mockResolvedValue({
        crews: [shared],
        location: null,
        locationNotFound: false,
      })
      const { findByText, queryByLabelText, getByText } = render(<LaborScreen />)
      expect(await findByText('Cy Crew')).toBeTruthy()
      expect(searchCrews).not.toHaveBeenCalled()
      expect(queryByLabelText('My list')).toBeNull()
      expect(getByText('+ Add Crew')).toBeTruthy()
    })

    it('says so when the company list is empty', async () => {
      access.mockReturnValue(DRIVER)
      searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
      searchCompanyCrews.mockResolvedValue({ crews: [], location: null, locationNotFound: false })
      const { findByText, getByLabelText } = render(<LaborScreen />)
      await findByText('Ace Movers')
      fireEvent.press(getByLabelText('Company'))
      expect(await findByText('No company crews yet')).toBeTruthy()
    })
  })

  describe('My crew segment', () => {
    const diaz = {
      id: 'm1',
      firstName: 'Ana',
      lastName: 'Diaz',
      email: null,
      cidNumber: 'C1',
      cidIssuedOn: '2024-01-01',
      phone: '+14045557777',
      phoneDisplay: '(404) 555-7777',
      everyJob: false,
      updatedAt: '2026-10-26T00:00:00.000Z',
    }

    const openMyCrew = async () => {
      searchCrews.mockResolvedValue({ crews: [ace], location: null, locationNotFound: false })
      const screen = render(<LaborScreen />)
      await screen.findByText('Ace Movers')
      fireEvent.press(screen.getByLabelText('My crew'))
      return screen
    }

    it('lists my crew without the crew search, and opens a member', async () => {
      getMyCrew.mockResolvedValue([diaz])
      const { findByText, getByText, queryByPlaceholderText, queryByText, getByLabelText } =
        await openMyCrew()
      expect(await findByText('Ana Diaz')).toBeTruthy()
      expect(getByText('(404) 555-7777 · CID C1')).toBeTruthy()
      expect(queryByPlaceholderText('ZIP, city, state, name or phone')).toBeNull()
      expect(queryByText('Export')).toBeNull()
      fireEvent.press(getByLabelText('Edit Ana Diaz'))
      expect(push).toHaveBeenCalledWith({
        pathname: '/labor/packer',
        params: { myCrew: '1', id: 'm1' },
      })
      fireEvent.press(getByText('+ Add to my crew'))
      expect(push).toHaveBeenLastCalledWith({ pathname: '/labor/packer', params: { myCrew: '1' } })
    })

    it('saves Every job straight from the list', async () => {
      getMyCrew.mockResolvedValue([diaz])
      updateMyCrewMember.mockResolvedValue({ ...diaz, everyJob: true })
      const { findByLabelText } = await openMyCrew()
      fireEvent(await findByLabelText('Every job: Ana Diaz'), 'valueChange', true)
      await waitFor(() => expect(updateMyCrewMember).toHaveBeenCalledWith('m1', { everyJob: true }))
      expect((await findByLabelText('Every job: Ana Diaz')).props.value).toBe(true)
    })

    it('puts the switch back when the save fails', async () => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => {})
      getMyCrew.mockResolvedValue([diaz])
      updateMyCrewMember.mockRejectedValue(new Error('nope'))
      const { findByLabelText } = await openMyCrew()
      fireEvent(await findByLabelText('Every job: Ana Diaz'), 'valueChange', true)
      await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Couldn’t save', 'nope'))
      expect((await findByLabelText('Every job: Ana Diaz')).props.value).toBe(false)
    })

    it('says so when my crew is empty', async () => {
      getMyCrew.mockResolvedValue([])
      const { findByText } = await openMyCrew()
      expect(await findByText('No one in your crew yet')).toBeTruthy()
    })

    it('is not offered to an Operations-only user', async () => {
      access.mockReturnValue(OPS_ONLY)
      searchCompanyCrews.mockResolvedValue({ crews: [], location: null, locationNotFound: false })
      const { findByText, queryByLabelText } = render(<LaborScreen />)
      await findByText('No company crews yet')
      expect(queryByLabelText('My crew')).toBeNull()
    })
  })
})
