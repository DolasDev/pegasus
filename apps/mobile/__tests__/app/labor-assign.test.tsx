import React from 'react'
import { Alert } from 'react-native'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import AssignCrewScreen from '../../app/labor/assign'
import NewCrewScreen from '../../app/labor/new'
import PackerScreen from '../../app/labor/packer'
import { LaborService } from '../../src/services/laborService'
import type { LaborActivityCrewInput, LaborCrew } from '../../src/types/labor'

jest.mock('../../src/services/laborService', () => {
  const actual = jest.requireActual('../../src/services/laborService')
  return {
    ...actual,
    LaborService: {
      searchCrews: jest.fn(),
      getOrderActivities: jest.fn(),
      updateActivityLabor: jest.fn(),
      addCrew: jest.fn(),
      addPacker: jest.fn(),
    },
  }
})

const svc = LaborService as jest.Mocked<typeof LaborService>
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismiss: jest.fn() }
const A = '+14045550101'
const B = '+14045550102'

const crew = (phone: string, name: string): LaborCrew => ({
  phone,
  phoneDisplay: phone,
  name,
  nickname: null,
  displayName: name,
  email: null,
  serviceAreas: [],
  packerCount: 0,
  myRating: null,
  averageRating: null,
  addedAt: '2026-10-20T00:00:00.000Z',
})

/** Runs the read-modify-write callback the screen passed, on `start`. */
function changeApplied(start: LaborActivityCrewInput[]) {
  const change = svc.updateActivityLabor.mock.calls[0]![2]
  return change(start)
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(useRouter as jest.Mock).mockReturnValue(router)
  ;(useLocalSearchParams as jest.Mock).mockReturnValue({ activityId: '11', orderNum: '100' })
  svc.updateActivityLabor.mockResolvedValue({} as never)
})

describe('AssignCrewScreen', () => {
  beforeEach(() => {
    svc.searchCrews.mockResolvedValue({
      crews: [crew(A, 'Ace'), crew(B, 'Bee')],
      location: null,
      locationNotFound: false,
    })
    svc.getOrderActivities.mockResolvedValue([
      {
        id: 11,
        orderNum: 100,
        typeCode: 'PACK',
        typeName: 'Pack',
        typeAbbreviation: null,
        plannedStart: null,
        estimatedDate: null,
        actualDate: null,
        editable: true,
        crews: [
          {
            phone: A,
            phoneDisplay: A,
            name: 'Ace',
            nickname: null,
            displayName: 'Ace',
            inMyBook: true,
            packers: [],
          },
        ],
      },
    ])
  })

  it('marks crews already on the activity', async () => {
    const { findByText, getAllByText } = render(<AssignCrewScreen />)
    expect(await findByText('Bee')).toBeTruthy()
    expect(getAllByText('Already on this activity')).toHaveLength(1)
  })

  it('assigns a picked crew and goes back', async () => {
    const { findByText } = render(<AssignCrewScreen />)
    fireEvent.press(await findByText('Bee'))
    await waitFor(() => expect(router.back).toHaveBeenCalled())
    expect(svc.updateActivityLabor).toHaveBeenCalledWith('100', 11, expect.any(Function))
    expect(changeApplied([{ phone: A, packerIds: ['p1'] }])).toEqual([
      { phone: A, packerIds: ['p1'] },
      { phone: B, packerIds: [] },
    ])
  })

  it('just goes back for a crew already assigned', async () => {
    const { findByText } = render(<AssignCrewScreen />)
    fireEvent.press(await findByText('Ace'))
    expect(router.back).toHaveBeenCalled()
    expect(svc.updateActivityLabor).not.toHaveBeenCalled()
  })

  it('opens New crew in activity mode, and the contacts import', async () => {
    const { findByText, getByText } = render(<AssignCrewScreen />)
    fireEvent.press(await findByText('New crew'))
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/labor/new',
      params: { activityId: '11', orderNum: '100' },
    })
    fireEvent.press(getByText('From contacts'))
    expect(router.push).toHaveBeenLastCalledWith('/labor/import')
  })
})

describe('NewCrewScreen from an activity', () => {
  const fill = (utils: ReturnType<typeof render>) => {
    fireEvent.changeText(utils.getByLabelText('Phone *'), '404-555-0102')
    fireEvent.changeText(utils.getByLabelText('Crew name *'), 'Bee')
    fireEvent.press(utils.getByText('Add crew'))
  }

  it('adds the crew, assigns it, and returns past the picker', async () => {
    svc.addCrew.mockResolvedValue({ crew: { phone: B } as never, outcome: 'added' })
    fill(render(<NewCrewScreen />))
    await waitFor(() => expect(router.dismiss).toHaveBeenCalledWith(2))
    expect(changeApplied([])).toEqual([{ phone: B, packerIds: [] }])
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('goes back to the picker when the assign fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    svc.addCrew.mockResolvedValue({ crew: { phone: B } as never, outcome: 'added' })
    svc.updateActivityLabor.mockRejectedValue(new Error('down'))
    fill(render(<NewCrewScreen />))
    await waitFor(() => expect(router.back).toHaveBeenCalled())
    expect(alert).toHaveBeenCalledWith('Crew added, not assigned', 'down')
    expect(router.dismiss).not.toHaveBeenCalled()
  })

  it('opens the crew page when not from an activity', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({})
    svc.addCrew.mockResolvedValue({ crew: { phone: B } as never, outcome: 'added' })
    fill(render(<NewCrewScreen />))
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/labor/[phone]',
        params: { phone: B },
      }),
    )
    expect(svc.updateActivityLabor).not.toHaveBeenCalled()
  })
})

describe('PackerScreen from an activity', () => {
  it('adds the packer and selects it on the activity', async () => {
    ;(useLocalSearchParams as jest.Mock).mockReturnValue({
      phone: A,
      activityId: '11',
      orderNum: '100',
    })
    svc.addPacker.mockResolvedValue({ id: 'p9' } as never)
    const { getByLabelText, getByText } = render(<PackerScreen />)
    fireEvent.changeText(getByLabelText('First name *'), 'Pat')
    fireEvent.changeText(getByLabelText('Last name *'), 'Lee')
    fireEvent.changeText(getByLabelText('Email'), 'pat@example.com')
    fireEvent.press(getByText('Add packer'))
    await waitFor(() => expect(router.back).toHaveBeenCalled())
    expect(svc.updateActivityLabor).toHaveBeenCalledWith('100', 11, expect.any(Function))
    expect(changeApplied([{ phone: A, packerIds: ['p1'] }])).toEqual([
      { phone: A, packerIds: ['p1', 'p9'] },
    ])
  })
})
