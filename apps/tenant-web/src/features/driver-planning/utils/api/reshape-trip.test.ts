import { describe, it, expect } from 'vitest'
import { reshapeTrip, reshapeTripList } from './reshape-trip'

describe('reshapeTrip', () => {
  it('builds nested relations from the flat bridge columns', () => {
    const flat = {
      id: 7,
      trip_title: 'Smith',
      TripStatus_id: 5,
      status_status: 'Finalized',
      status_id: 5,
      driver_id: 19800,
      driver_name: 'JANE DOE',
      agent_code: 'A1',
      origin_state_id: 42,
      origin_geo_code: 'PA',
      origin_geo_name: 'PENNSYLVANIA',
      origin_zone_code: '1',
      destination_state_id: 59,
      destination_geo_code: 'WI',
      created_by_id: 2076,
      planner_first_name: 'RON',
      planner_last_name: 'ZAHARI',
      dispatcher_id: 1196,
      dispatcher_first_name: 'SABRINA',
      dispatcher_last_name: 'POBUTA',
      internal_status: 'active',
    }
    const t = reshapeTrip(flat)
    expect(t.status).toEqual({ id: 5, status_id: 5, status: 'Finalized' })
    expect(t.driver).toMatchObject({ driver_id: 19800, driver_name: 'JANE DOE', agent_code: 'A1' })
    expect(t.originState).toMatchObject({ state_id: 42, geo_code: 'PA', zone: '1' })
    expect(t.destinationState).toMatchObject({ state_id: 59, geo_code: 'WI' })
    expect(t.planner).toEqual({ code: 2076, first_name: 'RON', last_name: 'ZAHARI' })
    expect(t.dispatcher).toEqual({ code: 1196, first_name: 'SABRINA', last_name: 'POBUTA' })
    // Flat columns are preserved.
    expect(t.id).toBe(7)
    expect(t.internal_status).toBe('active')
  })

  it('does not clobber an already-nested trip', () => {
    const nested = { id: 1, status: { status: 'Pending' }, driver: { driver_name: 'X' } }
    expect(reshapeTrip(nested)).toEqual(nested)
  })

  it('reshapes activity.activityType and stitches shipment onto trip activities', () => {
    const t = reshapeTrip({
      id: 1,
      activities: [{ activityId: 10, order_num: 555, ActivityType_code: 'PACK' }],
      shipments: [
        {
          order_num: 555,
          shipper_name: 'Doe',
          activities: [{ activityId: 10, ActivityType_code: 'PACK' }],
        },
      ],
    })
    expect(t.activities[0].activityType).toEqual({
      code: 'PACK',
      name: undefined,
      abbreviation: undefined,
    })
    expect(t.activities[0].shipment).toMatchObject({ order_num: 555, shipper_name: 'Doe' })
    expect(t.shipments[0].activities[0].activityType.code).toBe('PACK')
  })

  it('copies the activityType edit flags from the flat bridge columns', () => {
    // Regression: `isCanEditDates` gates the PendingTrips date-edit popover and
    // `isHasETA` gates the ActivityGantt date pickers. Dropping them here left
    // every persisted activity uneditable.
    const t = reshapeTrip({
      id: 1,
      activities: [
        {
          activityId: 10,
          order_num: 555,
          ActivityType_code: 'PACK',
          activityType_code: 'PACK',
          activityType_isCanEditDates: true,
          activityType_isHasETA: false,
        },
      ],
    })
    expect(t.activities[0].activityType).toMatchObject({
      code: 'PACK',
      isCanEditDates: true,
      isHasETA: false,
    })
  })

  it('aliases activity.id → activity.activityId on trip + shipment activities', () => {
    // Regression: the cloud-direct handler in apps/api selects
    // `LongDistanceDispatchActivity.id` (no `AS activityId`), but every ported
    // ActivityGantt / Trip call site still reads `activity.activityId` — most
    // critically `updateActivityForTrip(selectedActivity.activityId, …)` which
    // builds the save URL `/activities/${activityId}`. Without this alias,
    // every save POSTs to `/activities/undefined`, the handler 400s with
    // "Invalid activity id", and the redux thunk swallows it. Keep this alias
    // wired so the bug stays fixed even if the underlying API column never
    // gets renamed.
    const t = reshapeTrip({
      id: 1,
      activities: [{ id: 42, order_num: 555, ActivityType_code: 'PACK' }],
      shipments: [
        {
          order_num: 555,
          shipper_name: 'Doe',
          activities: [{ id: 42, ActivityType_code: 'PACK' }],
        },
      ],
    })
    expect(t.activities[0].activityId).toBe(42)
    expect(t.activities[0].id).toBe(42)
    expect(t.shipments[0].activities[0].activityId).toBe(42)
  })

  it('does not overwrite an existing activityId when the bridge already sets it', () => {
    // Defensive: if the bridge ever ships both `id` and `activityId` (or only
    // `activityId`, as the legacy TypeORM entity did), the explicit
    // `activityId` wins — the alias only fills in missing values.
    const t = reshapeTrip({
      id: 1,
      activities: [{ id: 7, activityId: 99, ActivityType_code: 'PACK' }],
    })
    expect(t.activities[0].activityId).toBe(99)
  })

  it('leaves activityId undefined when neither id nor activityId is present', () => {
    // Edge case: a malformed/empty activity row shouldn't fabricate an id.
    const t = reshapeTrip({
      id: 1,
      activities: [{ order_num: 1, ActivityType_code: 'PACK' }],
    })
    expect(t.activities[0].activityId).toBeUndefined()
  })

  it('reshapeTripList maps an array and passes non-arrays through', () => {
    expect(reshapeTripList([{ id: 1, driver_id: 2 }])[0].driver).toMatchObject({ driver_id: 2 })
    expect(reshapeTripList(null)).toBeNull()
    expect(reshapeTripList(undefined)).toBeUndefined()
  })
})
