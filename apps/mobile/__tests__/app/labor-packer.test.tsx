import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ApiError } from '@pegasus/api-http'
import PackerScreen, { formatDateInput, localToday } from '../../app/labor/packer'
import { LaborService } from '../../src/services/laborService'

jest.mock('../../src/services/laborService', () => ({
  LaborService: {
    getCrew: jest.fn(),
    addPacker: jest.fn(),
    updatePacker: jest.fn(),
    getMyCrew: jest.fn(),
    addMyCrewMember: jest.fn(),
    updateMyCrewMember: jest.fn(),
    removeMyCrewMember: jest.fn(),
    updateActivityMembers: jest.fn(),
  },
}))

const svc = LaborService as jest.Mocked<typeof LaborService>
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() }
const PHONE = '+14045550101'

beforeEach(() => {
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ phone: PHONE })
  ;(useRouter as jest.Mock).mockReturnValue(router)
})

describe('packer form helpers', () => {
  it('formats typed digits as YYYY-MM-DD', () => {
    expect(formatDateInput('2024')).toBe('2024')
    expect(formatDateInput('20240')).toBe('2024-0')
    expect(formatDateInput('2024-03-019')).toBe('2024-03-01')
  })

  it('reads today in the device timezone', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})

describe('PackerScreen', () => {
  it('requires a contact method before calling the API', async () => {
    const { getByLabelText, getByText, findByRole } = render(<PackerScreen />)
    fireEvent.changeText(getByLabelText('First name *'), 'Pat')
    fireEvent.changeText(getByLabelText('Last name *'), 'Lee')
    fireEvent.press(getByText('Add packer'))
    expect(await findByRole('alert')).toBeTruthy()
    expect(svc.addPacker).not.toHaveBeenCalled()
  })

  it('asks for the issue date only once a CID is entered, and requires it', async () => {
    const { getByLabelText, queryByLabelText, getByText, findByRole } = render(<PackerScreen />)
    expect(queryByLabelText('CID issue date *')).toBeNull()
    fireEvent.changeText(getByLabelText('First name *'), 'Pat')
    fireEvent.changeText(getByLabelText('Last name *'), 'Lee')
    fireEvent.changeText(getByLabelText('CID number (Candidate ID)'), 'C123')
    expect(getByLabelText('CID issue date *')).toBeTruthy()
    fireEvent.press(getByText('Add packer'))
    expect(await findByRole('alert')).toBeTruthy()
    expect(svc.addPacker).not.toHaveBeenCalled()
  })

  it('adds a packer and goes back', async () => {
    svc.addPacker.mockResolvedValue({} as never)
    const { getByLabelText, getByText } = render(<PackerScreen />)
    fireEvent.changeText(getByLabelText('First name *'), 'Pat')
    fireEvent.changeText(getByLabelText('Last name *'), 'Lee')
    fireEvent.changeText(getByLabelText('CID number (Candidate ID)'), 'C123')
    fireEvent.changeText(getByLabelText('CID issue date *'), '20240301')
    fireEvent.press(getByText('Add packer'))
    await waitFor(() =>
      expect(svc.addPacker).toHaveBeenCalledWith(PHONE, {
        firstName: 'Pat',
        lastName: 'Lee',
        email: null,
        cidNumber: 'C123',
        cidIssuedOn: '2024-03-01',
        phone: null,
      }),
    )
    expect(router.back).toHaveBeenCalled()
  })

  it('explains a duplicate packer', async () => {
    svc.addPacker.mockRejectedValue(new ApiError('dup', 'PACKER_DUPLICATE', 409))
    const { getByLabelText, getByText, findByText } = render(<PackerScreen />)
    fireEvent.changeText(getByLabelText('First name *'), 'Pat')
    fireEvent.changeText(getByLabelText('Last name *'), 'Lee')
    fireEvent.changeText(getByLabelText('Email'), 'pat@example.com')
    fireEvent.press(getByText('Add packer'))
    expect(
      await findByText('This crew already has a packer with that last name and CID or email.'),
    ).toBeTruthy()
    expect(router.back).not.toHaveBeenCalled()
  })

  it('edits an existing packer, clearing a field with null', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ phone: PHONE, id: 'p1' })
    svc.getCrew.mockResolvedValue({
      packers: [
        {
          id: 'p1',
          firstName: 'Pat',
          lastName: 'Lee',
          email: 'pat@example.com',
          cidNumber: null,
          cidIssuedOn: null,
          phone: '+14045550199',
          phoneDisplay: '(404) 555-0199',
          updatedAt: '',
        },
      ],
    } as never)
    svc.updatePacker.mockResolvedValue({} as never)
    const { findByDisplayValue, getByLabelText, getByText } = render(<PackerScreen />)
    expect(await findByDisplayValue('pat@example.com')).toBeTruthy()
    fireEvent.changeText(getByLabelText('Email'), '')
    fireEvent.press(getByText('Save packer'))
    await waitFor(() =>
      expect(svc.updatePacker).toHaveBeenCalledWith(PHONE, 'p1', {
        firstName: 'Pat',
        lastName: 'Lee',
        email: null,
        cidNumber: null,
        cidIssuedOn: null,
        phone: '(404) 555-0199',
      }),
    )
  })

  it('says when the packer being edited is gone', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ phone: PHONE, id: 'gone' })
    svc.getCrew.mockResolvedValue({ packers: [] } as never)
    const { findByText } = render(<PackerScreen />)
    expect(await findByText('This packer no longer exists.')).toBeTruthy()
  })
})

describe('PackerScreen — My crew', () => {
  const member = {
    id: 'm1',
    firstName: 'Ana',
    lastName: 'Diaz',
    email: null,
    cidNumber: null,
    cidIssuedOn: null,
    phone: '+14045557777',
    phoneDisplay: '(404) 555-7777',
    everyJob: true,
    updatedAt: '2026-10-26T00:00:00.000Z',
  }

  const fill = (getByLabelText: (l: string) => unknown) => {
    fireEvent.changeText(getByLabelText('First name *') as never, 'Pat')
    fireEvent.changeText(getByLabelText('Last name *') as never, 'Lee')
    fireEvent.changeText(getByLabelText('Phone') as never, '404-555-7777')
  }

  it('adds a member with Every job and ticks them on the activity it came from', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      myCrew: '1',
      activityId: '11',
      orderNum: '100',
    })
    svc.addMyCrewMember.mockResolvedValue({ ...member, id: 'm9' })
    svc.updateActivityMembers.mockResolvedValue({} as never)
    const { getByLabelText, getByText } = render(<PackerScreen />)
    fill(getByLabelText)
    fireEvent(getByLabelText('Every job'), 'valueChange', true)
    fireEvent.press(getByText('Add crew member'))
    await waitFor(() =>
      expect(svc.addMyCrewMember).toHaveBeenCalledWith({
        firstName: 'Pat',
        lastName: 'Lee',
        email: null,
        cidNumber: null,
        cidIssuedOn: null,
        phone: '404-555-7777',
        everyJob: true,
      }),
    )
    await waitFor(() =>
      expect(svc.updateActivityMembers).toHaveBeenCalledWith('100', 11, expect.any(Function)),
    )
    expect(svc.addPacker).not.toHaveBeenCalled()
    expect(router.back).toHaveBeenCalled()
  })

  it('loads a member for editing and saves the switch', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ myCrew: '1', id: 'm1' })
    svc.getMyCrew.mockResolvedValue([member])
    svc.updateMyCrewMember.mockResolvedValue(member)
    const { findByDisplayValue, getByLabelText, getByText } = render(<PackerScreen />)
    expect(await findByDisplayValue('Diaz')).toBeTruthy()
    expect(getByLabelText('Every job').props.value).toBe(true)
    fireEvent(getByLabelText('Every job'), 'valueChange', false)
    fireEvent.press(getByText('Save crew member'))
    await waitFor(() =>
      expect(svc.updateMyCrewMember).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ lastName: 'Diaz', everyJob: false }),
      ),
    )
  })

  it('removes a member after confirming', async () => {
    const { Alert } = jest.requireActual('react-native')
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as Array<{ style?: string; onPress?: () => void }>
      buttons.find((b) => b.style === 'destructive')?.onPress?.()
    })
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ myCrew: '1', id: 'm1' })
    svc.getMyCrew.mockResolvedValue([member])
    svc.removeMyCrewMember.mockResolvedValue()
    const { findByText } = render(<PackerScreen />)
    fireEvent.press(await findByText('Remove from my crew'))
    await waitFor(() => expect(svc.removeMyCrewMember).toHaveBeenCalledWith('m1'))
    await waitFor(() => expect(router.back).toHaveBeenCalled())
  })

  it('explains a duplicate member', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({ myCrew: '1' })
    svc.addMyCrewMember.mockRejectedValue(new ApiError('dup', 'MEMBER_DUPLICATE', 409))
    const { getByLabelText, getByText, findByText } = render(<PackerScreen />)
    fill(getByLabelText)
    fireEvent.press(getByText('Add crew member'))
    expect(await findByText(/Your crew already has someone/)).toBeTruthy()
  })
})
