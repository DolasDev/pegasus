import { LaborService, activityLaborInput, withCrew, withoutCrew, withPacker } from './laborService'
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
