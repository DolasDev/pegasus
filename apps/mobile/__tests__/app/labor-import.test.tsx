import React from 'react'
import { Alert, Linking } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { useRouter } from 'expo-router'
import ImportContactsScreen, { summarizeImport } from '../../app/labor/import'
import NewCrewScreen from '../../app/labor/new'
import { LaborService } from '../../src/services/laborService'
import { loadPhoneContacts, type ContactCandidate } from '../../src/services/laborContacts'

jest.mock('../../src/services/laborService', () => ({
  LaborService: { searchCrews: jest.fn(), importCrews: jest.fn(), addCrew: jest.fn() },
}))
jest.mock('../../src/services/laborContacts', () => ({ loadPhoneContacts: jest.fn() }))

const svc = LaborService as jest.Mocked<typeof LaborService>
const load = loadPhoneContacts as jest.Mock
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() }

const num = (e164: string, label = 'mobile') => ({ label, e164, display: e164 })
const contacts: ContactCandidate[] = [
  { id: 'c1', name: 'Ace Movers', email: 'ace@example.com', numbers: [num('+14045550101')] },
  {
    id: 'c2',
    name: 'Bob Crew',
    email: null,
    numbers: [num('+14045550102'), num('+14045550103', 'work')],
  },
  { id: 'c3', name: 'Cal Labor', email: null, numbers: [num('+14045550104')] },
]

beforeEach(() => {
  ;(useRouter as jest.Mock).mockReturnValue(router)
  svc.searchCrews.mockResolvedValue({
    crews: [{ phone: '+14045550104' }] as never,
    location: null,
    locationNotFound: false,
  })
})

describe('summarizeImport', () => {
  it('counts every outcome', () => {
    expect(
      summarizeImport([
        { phone: '1', outcome: 'added' },
        { phone: '2', outcome: 'linkedExisting' },
        { phone: '3', outcome: 'alreadyInList' },
        { phone: '4', outcome: 'invalid' },
        { phone: '5', outcome: 'rateLimited' },
      ]),
    ).toBe(
      '2 crews added. 1 already in your list. 1 skipped — not a valid phone number. 1 not added — daily limit reached, try again tomorrow.',
    )
    expect(summarizeImport([{ phone: '1', outcome: 'added' }])).toBe('1 crew added.')
  })
})

describe('ImportContactsScreen', () => {
  it('sends a denied user to Settings once the OS stops asking', async () => {
    load.mockResolvedValue({ access: 'denied', canAskAgain: false, contacts: [] })
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue()
    const { findByText } = render(<ImportContactsScreen />)
    fireEvent.press(await findByText('Open Settings'))
    expect(open).toHaveBeenCalled()
  })

  it('marks crews already in my list, and imports the picked contacts with the chosen number', async () => {
    load.mockResolvedValue({ access: 'all', canAskAgain: true, contacts })
    svc.importCrews.mockResolvedValue([
      { phone: '+14045550101', outcome: 'added' },
      { phone: '+14045550103', outcome: 'linkedExisting' },
    ])
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByText, getByLabelText, getByText } = render(<ImportContactsScreen />)

    expect(await findByText('Added')).toBeTruthy() // Cal Labor
    expect(getByText('Select contacts to import')).toBeTruthy()

    fireEvent.press(getByLabelText('Ace Movers'))
    fireEvent.press(getByLabelText('Bob Crew'))
    fireEvent.press(getByText('work: +14045550103'))
    fireEvent.press(getByLabelText('Cal Labor')) // disabled — already added
    fireEvent.press(getByText('Import 2 crews'))

    await waitFor(() =>
      expect(svc.importCrews).toHaveBeenCalledWith([
        { phone: '+14045550101', name: 'Ace Movers', email: 'ace@example.com' },
        { phone: '+14045550103', name: 'Bob Crew', email: null },
      ]),
    )
    expect(alert).toHaveBeenCalledWith('Import finished', '2 crews added.', expect.any(Array))
    alert.mock.calls[0]![2]![0]!.onPress!()
    expect(router.back).toHaveBeenCalled()
  })

  it('keeps what earlier batches added when a later batch fails', async () => {
    const many: ContactCandidate[] = Array.from({ length: 201 }, (_, i) => ({
      id: `m${i}`,
      name: `Crew ${String(i).padStart(3, '0')}`,
      email: null,
      numbers: [num(`+1404556${String(i).padStart(4, '0')}`)],
    }))
    load.mockResolvedValue({ access: 'all', canAskAgain: true, contacts: many })
    svc.importCrews
      .mockResolvedValueOnce(
        many.slice(0, 200).map((c) => ({ phone: c.numbers[0]!.e164, outcome: 'added' as const })),
      )
      .mockRejectedValueOnce(new Error('Network request failed'))
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { findByLabelText, getByLabelText, getByText, findByText } = render(
      <ImportContactsScreen />,
    )
    await findByLabelText('Crew 000')
    // FlatList renders a window; select through the search box to reach every row.
    for (const c of many) {
      fireEvent.changeText(getByLabelText('Search contacts'), c.name)
      fireEvent.press(getByLabelText(c.name))
    }
    fireEvent.press(getByText('Import 201 crews'))
    await waitFor(() => expect(alert).toHaveBeenCalled())
    expect(alert.mock.calls[0]![0]).toBe('Import stopped partway')
    expect(alert.mock.calls[0]![1]).toContain('200 crews added.')
    // Only the unimported contact stays selected for a retry.
    expect(await findByText('Import 1 crew')).toBeTruthy()
  })

  it('filters contacts by name', async () => {
    load.mockResolvedValue({ access: 'limited', canAskAgain: true, contacts })
    const { findByText, getByLabelText, queryByText } = render(<ImportContactsScreen />)
    expect(await findByText('Pegasus can see only the contacts you shared.')).toBeTruthy()
    fireEvent.changeText(getByLabelText('Search contacts'), 'bob')
    expect(queryByText('Ace Movers')).toBeNull()
    expect(queryByText('Bob Crew')).toBeTruthy()
  })
})

describe('NewCrewScreen', () => {
  it('rejects an invalid phone without calling the API', async () => {
    const { getByLabelText, getByText, findByRole } = render(<NewCrewScreen />)
    fireEvent.changeText(getByLabelText('Phone *'), '12')
    fireEvent.changeText(getByLabelText('Crew name *'), 'Ace')
    fireEvent.press(getByText('Add crew'))
    expect(await findByRole('alert')).toBeTruthy()
    expect(svc.addCrew).not.toHaveBeenCalled()
  })

  it('opens the crew, and explains linking to an existing one', async () => {
    svc.addCrew.mockResolvedValue({
      crew: { phone: '+14045550101', phoneDisplay: '(404) 555-0101', name: 'Ace Movers' } as never,
      outcome: 'linkedExisting',
    })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {})
    const { getByLabelText, getByText } = render(<NewCrewScreen />)
    fireEvent.changeText(getByLabelText('Phone *'), '404-555-0101')
    fireEvent.changeText(getByLabelText('Crew name *'), 'Big Al')
    fireEvent.press(getByText('Add crew'))
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/labor/[phone]',
        params: { phone: '+14045550101' },
      }),
    )
    expect(svc.addCrew).toHaveBeenCalledWith({ phone: '404-555-0101', name: 'Big Al', email: null })
    expect(alert.mock.calls[0]![0]).toBe('Crew already in Pegasus')
  })
})
