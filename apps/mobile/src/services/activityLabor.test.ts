import {
  LaborService,
  activityLaborInput,
  activityMemberIds,
  withCrew,
  withMember,
  withoutCrew,
  withPacker,
} from './laborService'
import type { LaborActivity } from '../types/labor'

const mockFetch = jest.fn()
jest.mock('../api/client', () => ({
  getApiClient: jest.fn(() => ({ fetch: mockFetch, fetchPaginated: jest.fn() })),
}))

const A = '+14045550101'
const B = '+14045550102'

const activity = (over: Partial<LaborActivity> = {}): LaborActivity => ({
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

beforeEach(() => mockFetch.mockReset())

describe('activity-labor set helpers', () => {
  it('keeps only selected packers in the body', () => {
    expect(activityLaborInput(activity())).toEqual([{ phone: A, packerIds: ['p1'] }])
  })

  it('adds a crew once, removes one, and toggles packers', () => {
    const base = activityLaborInput(activity())
    expect(withCrew(base, A)).toBe(base)
    expect(withCrew(base, B)).toEqual([...base, { phone: B, packerIds: [] }])
    expect(withoutCrew(base, A)).toEqual([])
    expect(withPacker(base, A, 'p2', true)).toEqual([{ phone: A, packerIds: ['p1', 'p2'] }])
    expect(withPacker(base, A, 'p1', false)).toEqual([{ phone: A, packerIds: [] }])
    expect(withPacker(base, A, 'p1', true)).toEqual([{ phone: A, packerIds: ['p1'] }])
  })
})

describe('My Crew set helpers', () => {
  const member = (id: string, selected: boolean) => ({
    id,
    firstName: 'M',
    lastName: id,
    phoneDisplay: null,
    everyJob: false,
    mine: true,
    selected,
  })

  it('reads the ticked members, and none from an older API', () => {
    expect(
      activityMemberIds(activity({ myCrew: [member('m1', true), member('m2', false)] })),
    ).toEqual(['m1'])
    expect(activityMemberIds(activity())).toEqual([])
  })

  it('ticks and unticks one member', () => {
    expect(withMember(['m1'], 'm2', true)).toEqual(['m1', 'm2'])
    expect(withMember(['m1', 'm2'], 'm1', false)).toEqual(['m2'])
    expect(withMember(['m1'], 'm1', true)).toEqual(['m1'])
  })
})

describe('LaborService My Crew', () => {
  it('lists, adds, edits and removes members', async () => {
    mockFetch.mockResolvedValueOnce(null)
    expect(await LaborService.getMyCrew()).toEqual([])
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/my-crew')

    mockFetch.mockResolvedValueOnce({ id: 'm1' })
    await LaborService.addMyCrewMember({
      firstName: 'A',
      lastName: 'B',
      phone: '1',
      everyJob: true,
    })
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/my-crew', {
      method: 'POST',
      body: JSON.stringify({ firstName: 'A', lastName: 'B', phone: '1', everyJob: true }),
    })

    mockFetch.mockResolvedValueOnce({ id: 'm1' })
    await LaborService.updateMyCrewMember('m1', { everyJob: false })
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/my-crew/m1', {
      method: 'PATCH',
      body: JSON.stringify({ everyJob: false }),
    })

    mockFetch.mockResolvedValueOnce(null)
    await LaborService.removeMyCrewMember('m1')
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/my-crew/m1', { method: 'DELETE' })
  })
})

describe('LaborService activity labor', () => {
  it('reads an order and replaces an activity set', async () => {
    mockFetch.mockResolvedValueOnce([activity()])
    expect(await LaborService.getOrderActivities(100)).toHaveLength(1)
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/orders/100/activities')

    mockFetch.mockResolvedValueOnce(activity())
    await LaborService.setActivityLabor(11, [{ phone: B, packerIds: [] }])
    expect(mockFetch).toHaveBeenLastCalledWith('/api/v1/labor/activities/11', {
      method: 'PUT',
      body: JSON.stringify({ crews: [{ phone: B, packerIds: [] }] }),
    })
  })

  it('sends memberIds only when given', async () => {
    mockFetch.mockResolvedValueOnce(activity())
    await LaborService.setActivityLabor(11, [], ['m1'])
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ crews: [], memberIds: ['m1'] })
  })

  it('read-modify-writes one activity', async () => {
    mockFetch.mockResolvedValueOnce([activity({ id: 10, crews: [] }), activity()])
    mockFetch.mockResolvedValueOnce(activity())
    await LaborService.updateActivityLabor(100, 11, (crews) => withCrew(crews, B))
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
      crews: [
        { phone: A, packerIds: ['p1'] },
        { phone: B, packerIds: [] },
      ],
    })
  })

  it('fails when the activity is gone', async () => {
    mockFetch.mockResolvedValueOnce([])
    await expect(LaborService.updateActivityLabor(100, 11, (c) => c)).rejects.toThrow(
      'no longer assigned',
    )
  })
})
