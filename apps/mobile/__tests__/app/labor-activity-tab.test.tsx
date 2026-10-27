import React from 'react'
import { Alert } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { useRouter } from 'expo-router'
import { ActivityLaborTab, activityDateLabel } from '../../src/components/labor/ActivityLaborTab'
import { LaborService } from '../../src/services/laborService'
import type { LaborActivity } from '../../src/types/labor'

jest.mock('../../src/services/laborService', () => {
  const actual = jest.requireActual('../../src/services/laborService')
  return {
    ...actual,
    LaborService: {
      getOrderActivities: jest.fn(),
      setActivityLabor: jest.fn(),
      updateActivityMembers: jest.fn(),
    },
  }
})

const svc = LaborService as jest.Mocked<typeof LaborService>
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() }
const A = '+14045550101'

const pack = (over: Partial<LaborActivity> = {}): LaborActivity => ({
  id: 11,
  orderNum: 100,
  typeCode: 'PACK',
  typeName: 'Pack',
  typeAbbreviation: 'PK',
  plannedStart: '2026-10-20',
  estimatedDate: null,
  actualDate: null,
  editable: true,
  crews: [
    {
      phone: A,
      phoneDisplay: '(404) 555-0101',
      name: 'Ace',
      nickname: null,
      displayName: 'Ace',
      inMyBook: true,
      packers: [
        { id: 'p1', firstName: 'Ana', lastName: 'Diaz', phoneDisplay: null, selected: true },
        { id: 'p2', firstName: 'Bo', lastName: 'Ruiz', phoneDisplay: null, selected: false },
      ],
    },
  ],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(useRouter as jest.Mock).mockReturnValue(router)
})

describe('activityDateLabel', () => {
  it('prefers actual, then ETA, then planned', () => {
    expect(activityDateLabel(pack({ actualDate: '2026-10-22', estimatedDate: '2026-10-21' }))).toBe(
      'Actual 10/22/26',
    )
    expect(activityDateLabel(pack({ estimatedDate: '2026-10-21' }))).toBe('ETA 10/21/26')
    expect(activityDateLabel(pack())).toBe('Planned 10/20/26')
    expect(activityDateLabel(pack({ plannedStart: null }))).toBeNull()
  })
})

describe('ActivityLaborTab', () => {
  it('lists my activities with their crews and packer checklist', async () => {
    svc.getOrderActivities.mockResolvedValue([
      pack(),
      pack({ id: 12, typeName: 'Load', crews: [] }),
    ])
    const { findByText, getByLabelText, getByText, getAllByText } = render(
      <ActivityLaborTab orderNum={100} />,
    )
    expect(await findByText('Pack')).toBeTruthy()
    expect(svc.getOrderActivities).toHaveBeenCalledWith(100)
    expect(getByText('Load')).toBeTruthy()
    expect(getByText('No crew assigned yet.')).toBeTruthy()
    expect(getByLabelText('Ana Diaz').props.accessibilityState.checked).toBe(true)
    expect(getByLabelText('Bo Ruiz').props.accessibilityState.checked).toBe(false)
    expect(getAllByText('Assign crew')).toHaveLength(2)
  })

  it('toggles a packer by saving the whole set', async () => {
    svc.getOrderActivities.mockResolvedValue([pack()])
    const after = pack()
    after.crews[0]!.packers[1]!.selected = true
    svc.setActivityLabor.mockResolvedValue(after)
    const { findByLabelText, getByLabelText } = render(<ActivityLaborTab orderNum={100} />)
    fireEvent.press(await findByLabelText('Bo Ruiz'))
    await waitFor(() =>
      // No memberIds: a crew change leaves My crew alone.
      expect(svc.setActivityLabor).toHaveBeenCalledWith(
        11,
        [{ phone: A, packerIds: ['p1', 'p2'] }],
        undefined,
      ),
    )
    await waitFor(() =>
      expect(getByLabelText('Bo Ruiz').props.accessibilityState.checked).toBe(true),
    )
  })

  it('alerts and keeps the old state when a save fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    svc.getOrderActivities.mockResolvedValue([pack()])
    svc.setActivityLabor.mockRejectedValue(new Error('nope'))
    const { findByLabelText, getByLabelText } = render(<ActivityLaborTab orderNum={100} />)
    fireEvent.press(await findByLabelText('Ana Diaz'))
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Couldn’t save labor', 'nope'))
    expect(getByLabelText('Ana Diaz').props.accessibilityState.checked).toBe(true)
  })

  it('removes a crew after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.()
    })
    svc.getOrderActivities.mockResolvedValue([pack()])
    svc.setActivityLabor.mockResolvedValue(pack({ crews: [] }))
    const { findByLabelText } = render(<ActivityLaborTab orderNum={100} />)
    fireEvent.press(await findByLabelText('Remove Ace'))
    expect(alert).toHaveBeenCalled()
    await waitFor(() => expect(svc.setActivityLabor).toHaveBeenCalledWith(11, [], undefined))
  })

  it('opens the crew picker and the packer form for the activity', async () => {
    svc.getOrderActivities.mockResolvedValue([pack()])
    const { findByText, getByLabelText } = render(<ActivityLaborTab orderNum={100} />)
    fireEvent.press(await findByText('Assign crew'))
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/labor/assign',
      params: { activityId: '11', orderNum: '100' },
    })
    fireEvent.press(getByLabelText('Add packer to Ace'))
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/labor/packer',
      params: { phone: A, activityId: '11', orderNum: '100' },
    })
  })

  it('is read-only when the activity is not mine to edit', async () => {
    svc.getOrderActivities.mockResolvedValue([pack({ editable: false })])
    const { findByText, queryByText, queryByLabelText, getByLabelText } = render(
      <ActivityLaborTab orderNum={100} />,
    )
    expect(await findByText('Pack')).toBeTruthy()
    expect(queryByText('Assign crew')).toBeNull()
    expect(queryByLabelText('Remove Ace')).toBeNull()
    expect(queryByLabelText('Add packer to Ace')).toBeNull()
    fireEvent.press(getByLabelText('Bo Ruiz'))
    expect(svc.setActivityLabor).not.toHaveBeenCalled()
  })

  it('hides Add packer for a crew no longer in my list', async () => {
    const a = pack()
    a.crews[0]!.inMyBook = false
    svc.getOrderActivities.mockResolvedValue([a])
    const { findByText, queryByLabelText } = render(<ActivityLaborTab orderNum={100} />)
    expect(await findByText('Pack')).toBeTruthy()
    expect(queryByLabelText('Add packer to Ace')).toBeNull()
  })

  describe('My crew', () => {
    const member = (id: string, lastName: string, over: Record<string, unknown> = {}) => ({
      id,
      firstName: 'M',
      lastName,
      phoneDisplay: null,
      everyJob: false,
      mine: true,
      selected: false,
      ...over,
    })

    it('ticks a member through a fresh read-modify-write of the activity', async () => {
      svc.getOrderActivities.mockResolvedValue([
        pack({
          myCrew: [member('m1', 'Diaz', { selected: true, everyJob: true }), member('m2', 'Ruiz')],
        }),
      ])
      svc.updateActivityMembers.mockResolvedValue(
        pack({
          myCrew: [
            member('m1', 'Diaz', { selected: true }),
            member('m2', 'Ruiz', { selected: true }),
          ],
        }),
      )
      const { findByLabelText, getByLabelText, getByText } = render(
        <ActivityLaborTab orderNum={100} />,
      )
      expect((await findByLabelText('M Diaz')).props.accessibilityState.checked).toBe(true)
      expect(getByText('Every job')).toBeTruthy()
      fireEvent.press(getByLabelText('M Ruiz'))
      await waitFor(() =>
        expect(svc.updateActivityMembers).toHaveBeenCalledWith(100, 11, expect.any(Function)),
      )
      // The change applies to whatever the server holds now, not the tab's snapshot.
      const change = svc.updateActivityMembers.mock.calls[0]![2]
      expect(change(['m1', 'auto'])).toEqual(['m1', 'auto', 'm2'])
      expect(svc.setActivityLabor).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(getByLabelText('M Ruiz').props.accessibilityState.checked).toBe(true),
      )
    })

    it('lets me untick, but not tick, someone no longer in my crew', async () => {
      svc.getOrderActivities.mockResolvedValue([
        pack({
          myCrew: [
            member('m1', 'Gone', { mine: false, selected: true }),
            member('m2', 'Other', { mine: false, selected: false }),
          ],
        }),
      ])
      const { findByLabelText, getByLabelText } = render(<ActivityLaborTab orderNum={100} />)
      expect((await findByLabelText('M Gone')).props.accessibilityState.disabled).toBe(false)
      expect(getByLabelText('M Other').props.accessibilityState.disabled).toBe(true)
    })

    it('offers Add to my crew on my activity, even with an empty crew', async () => {
      svc.getOrderActivities.mockResolvedValue([pack({ myCrew: [] })])
      const { findByText, getByLabelText } = render(<ActivityLaborTab orderNum={100} />)
      expect(await findByText('No one in your crew yet.')).toBeTruthy()
      fireEvent.press(getByLabelText('Add to my crew'))
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/labor/packer',
        params: { myCrew: '1', activityId: '11', orderNum: '100' },
      })
    })

    it('is hidden from an older API and read-only on an activity not mine', async () => {
      svc.getOrderActivities.mockResolvedValue([
        pack(),
        pack({
          id: 12,
          typeName: 'Load',
          editable: false,
          myCrew: [member('m1', 'Diaz', { selected: true })],
        }),
      ])
      const { findByText, queryAllByLabelText, getByLabelText, queryByLabelText } = render(
        <ActivityLaborTab orderNum={100} />,
      )
      expect(await findByText('Load')).toBeTruthy()
      expect(queryAllByLabelText('My crew')).toHaveLength(1)
      expect(queryByLabelText('Add to my crew')).toBeNull()
      fireEvent.press(getByLabelText('M Diaz'))
      expect(svc.setActivityLabor).not.toHaveBeenCalled()
    })
  })

  it('shows an empty state and a load error', async () => {
    svc.getOrderActivities.mockResolvedValueOnce([])
    const empty = render(<ActivityLaborTab orderNum={100} />)
    expect(await empty.findByText('No activities of yours')).toBeTruthy()

    svc.getOrderActivities.mockRejectedValueOnce(new Error('The order database is unavailable'))
    const failed = render(<ActivityLaborTab orderNum={100} />)
    expect(await failed.findByText('The order database is unavailable')).toBeTruthy()
  })
})
