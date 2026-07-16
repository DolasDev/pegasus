// ---------------------------------------------------------------------------
// Unit tests for computeTripSavePlan — the pure trip-save diff.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { computeTripSavePlan, type ExistingActivity } from './longhaul-trip-save'

// A shipment that buildShipmentActivities expands to PACK + LOAD + RDEL.
const shipment = (orderNum: number) => ({
  order_num: orderNum,
  pack_date2: '2026-06-01',
  plan_pack: '2026-06-01',
  load_date2: '2026-06-02',
  plan_load: '2026-06-02',
  del_date2: '2026-06-05',
  plan_del: '2026-06-05',
  shipper_add1: '1 A St',
  shipper_city: 'Reno',
  shipper_state: 'NV',
  shipper_zip: '89501',
  consignee_city: 'Boise',
  consignee_state: 'ID',
  consignee_zip: '83701',
})

const baseDto = (over: Record<string, unknown> = {}) => ({
  trip_title: 'T',
  driver: { id: 9, agent_code: 'AG' },
  dispatcher: { code: 5, first_name: 'Di', last_name: 'Patcher' },
  status: { id: 1, status_id: 1, status: 'Pending' },
  created_by_id: 7,
  updated_by_id: 7,
  shipments: [shipment(100)],
  ...over,
})

describe('computeTripSavePlan', () => {
  it('create: adds all generated activities, nothing to update/remove', () => {
    const plan = computeTripSavePlan(baseDto(), null, [])
    expect(plan.kind).toBe('plan')
    if (plan.kind !== 'plan') return
    expect(plan.isUpdate).toBe(false)
    expect(plan.tripId).toBeNull()
    expect(plan.activitiesToAdd).toHaveLength(3) // PACK, LOAD, RDEL
    expect(plan.activitiesToUpdate).toEqual([])
    expect(plan.removeIds).toEqual([])
    expect(plan.tripRow['driver_id']).toBe(9)
    expect(plan.tripRow['dispatcher_id']).toBe(5)
    // Added activities carry the driver/status overrides and the type code.
    const codes = plan.activitiesToAdd.map((a) => a['ActivityType_code']).sort()
    expect(codes).toEqual(['LOAD', 'PACK', 'RDEL'])
    expect(plan.activitiesToAdd.every((a) => a['assigned_driver_id'] === 9)).toBe(true)
    // Alias/relation keys never leak into the write.
    expect(plan.activitiesToAdd.every((a) => !('activityType' in a))).toBe(true)
  })

  it('update: diffs add / update / remove by (order_num + type) slot', () => {
    const existing: ExistingActivity[] = [
      { id: 1, order_num: 100, activityType_code: 'PACK', actual_date: null, TripMaster_id: 55 },
      { id: 2, order_num: 100, activityType_code: 'LOAD', actual_date: null, TripMaster_id: 55 },
      { id: 3, order_num: 999, activityType_code: 'RDEL', actual_date: null, TripMaster_id: 55 },
    ]
    const plan = computeTripSavePlan(
      baseDto({ id: 55 }),
      { driver_id: 9, dispatcher_id: 5 },
      existing,
    )
    expect(plan.kind).toBe('plan')
    if (plan.kind !== 'plan') return
    expect(plan.isUpdate).toBe(true)
    expect(plan.tripId).toBe(55)
    // PACK(100)+LOAD(100) match existing → update; RDEL(100) is new → add;
    // existing RDEL(999) not in DTO → remove.
    expect(plan.activitiesToUpdate.map((u) => u.id).sort()).toEqual([1, 2])
    expect(plan.activitiesToAdd.map((a) => a['ActivityType_code'])).toEqual(['RDEL'])
    expect(plan.removeIds).toEqual([3])
  })

  it('blocks removing an activity that has an actual_date', () => {
    const existing: ExistingActivity[] = [
      {
        id: 9,
        order_num: 999,
        activityType_code: 'RDEL',
        actual_date: '2026-06-01',
        TripMaster_id: 55,
      },
    ]
    const plan = computeTripSavePlan(
      baseDto({ id: 55 }),
      { driver_id: 9, dispatcher_id: 5 },
      existing,
    )
    expect(plan).toMatchObject({ kind: 'error', code: 'VALIDATION_ERROR' })
    if (plan.kind === 'error') expect(plan.error).toContain('actual dates')
  })

  it('blocks a driver change on an in-progress (>=4) trip', () => {
    const dto = baseDto({
      id: 55,
      driver: { id: 10 },
      status: { id: 4, status_id: 4, status: 'In Transit' },
    })
    const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, [])
    expect(plan).toMatchObject({ kind: 'error', code: 'VALIDATION_ERROR' })
    if (plan.kind === 'error') expect(plan.error).toContain('Cannot change driver')
  })

  it('allows the same driver on an in-progress trip', () => {
    const dto = baseDto({
      id: 55,
      driver: { id: 9 },
      status: { id: 4, status_id: 4, status: 'In Transit' },
    })
    const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, [])
    expect(plan.kind).toBe('plan')
  })

  // The tenant-web trip planner sends the scalar `driver_id` alongside a `driver`
  // object taken straight from the drivers list, which has `driver_id` and no
  // `id`. Resolving only `driver.id` silently wrote NULL over the assignment.
  describe('driver resolution', () => {
    it('reads the scalar driver_id sent by the planner', () => {
      const dto = baseDto({ driver: { driver_id: 3, driver_name: 'Pat' }, driver_id: 3 })
      const plan = computeTripSavePlan(dto, null, [])
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.tripRow['driver_id']).toBe(3)
      expect(plan.activitiesToAdd.every((a) => a['assigned_driver_id'] === 3)).toBe(true)
    })

    it('falls back to driver.driver_id when no scalar driver_id is sent', () => {
      const dto = baseDto({ driver: { driver_id: 3, driver_name: 'Pat' } })
      const plan = computeTripSavePlan(dto, null, [])
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.tripRow['driver_id']).toBe(3)
    })

    it('stores driver 0 ("None") as unassigned', () => {
      const dto = baseDto({ driver: { driver_id: 0, driver_name: 'None' }, driver_id: null })
      const plan = computeTripSavePlan(dto, null, [])
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.tripRow['driver_id']).toBeNull()
    })

    it('stores an absent driver as unassigned', () => {
      const dto = baseDto({ driver: null })
      const plan = computeTripSavePlan(dto, null, [])
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.tripRow['driver_id']).toBeNull()
    })
  })

  it('flags a dispatcher-change cascade over the existing order_nums', () => {
    const existing: ExistingActivity[] = [
      { id: 1, order_num: 100, activityType_code: 'PACK', actual_date: null, TripMaster_id: 55 },
      { id: 2, order_num: 200, activityType_code: 'RDEL', actual_date: null, TripMaster_id: 55 },
    ]
    // existing dispatcher 5 → new dispatcher 6
    const dto = baseDto({ id: 55, dispatcher: { code: 6, first_name: 'New', last_name: 'Disp' } })
    const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, existing)
    if (plan.kind !== 'plan') throw new Error('expected plan')
    expect(plan.dispatcherCascade).not.toBeNull()
    expect(plan.dispatcherCascade!.orderNums.sort()).toEqual([100, 200])
    expect(plan.dispatcherCascade!.operations_id).toBe(6)
    expect(plan.dispatcherCascade!.operations_name).toBe('New Disp')
  })

  it('no dispatcher cascade when the dispatcher is unchanged', () => {
    const plan = computeTripSavePlan(baseDto({ id: 55 }), { driver_id: 9, dispatcher_id: 5 }, [])
    if (plan.kind !== 'plan') throw new Error('expected plan')
    expect(plan.dispatcherCascade).toBeNull()
  })
})
