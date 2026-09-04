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

  // -------------------------------------------------------------------------
  // The DTO's activities are the final set — never re-derived.
  //
  // GET /trips/:id embeds each shipment's activities carrying this trip's
  // TripMaster_id. Running them back through buildShipmentActivities on save
  // dropped every one of them (it keeps only TripMaster_id == null rows) and
  // regenerated just PACK / LOAD-or-R19O / RDEL, so anything else the trip owned
  // fell into the remove set — 403ing the save when it had an actual_date, and
  // silently deleting it otherwise.
  // -------------------------------------------------------------------------
  describe('activities sent by the caller', () => {
    /** A shipment as GET /trips/:id returns it: activities already on THIS trip. */
    const trippedShipment = (orderNum: number, acts: Array<Record<string, unknown>>) => ({
      ...shipment(orderNum),
      activities: acts.map((a) => ({ order_num: orderNum, TripMaster_id: 55, ...a })),
    })

    it('keeps an extra-type activity the required-template set cannot regenerate', () => {
      // SIT-In was attached from the Add Activity menu and has since been
      // performed — the reported "Cannot remove 2 activity(s) with actual dates".
      const existing: ExistingActivity[] = [
        { id: 1, order_num: 100, activityType_code: 'R19O', actual_date: null, TripMaster_id: 55 },
        {
          id: 2,
          order_num: 100,
          activityType_code: 'SITIN',
          actual_date: '2026-06-03',
          TripMaster_id: 55,
        },
        { id: 3, order_num: 100, activityType_code: 'RDEL', actual_date: null, TripMaster_id: 55 },
      ]
      const dto = baseDto({
        id: 55,
        shipments: [
          trippedShipment(100, [
            { id: 1, ActivityType_code: 'R19O', activityType: { code: 'R19O' } },
            {
              id: 2,
              ActivityType_code: 'SITIN',
              activityType: { code: 'SITIN' },
              actual_date: '2026-06-03',
            },
            { id: 3, ActivityType_code: 'RDEL', activityType: { code: 'RDEL' } },
          ]),
        ],
      })

      const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, existing)
      if (plan.kind !== 'plan') throw new Error(`expected plan, got: ${plan.error}`)
      expect(plan.removeIds).toEqual([])
      expect(plan.activitiesToUpdate.map((u) => u.id).sort()).toEqual([1, 2, 3])
      expect(plan.activitiesToAdd).toEqual([])
    })

    it('keeps a required-type activity whose trigger column is no longer set', () => {
      // R19O only regenerates while the shipment row still carries rule19_id.
      const existing: ExistingActivity[] = [
        {
          id: 7,
          order_num: 100,
          activityType_code: 'R19O',
          actual_date: '2026-06-02',
          TripMaster_id: 55,
        },
      ]
      const dto = baseDto({
        id: 55,
        shipments: [
          {
            ...trippedShipment(100, [
              {
                id: 7,
                ActivityType_code: 'R19O',
                activityType: { code: 'R19O' },
                actual_date: '2026-06-02',
              },
            ]),
            rule19_id: null,
          },
        ],
      })

      const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, existing)
      if (plan.kind !== 'plan') throw new Error(`expected plan, got: ${plan.error}`)
      expect(plan.removeIds).toEqual([])
    })

    it('still removes an activity the planner deleted from the shipment', () => {
      // Deletion has to keep working — and must not be undone by auto-fill
      // regenerating the dropped RDEL template.
      const existing: ExistingActivity[] = [
        { id: 1, order_num: 100, activityType_code: 'LOAD', actual_date: null, TripMaster_id: 55 },
        { id: 2, order_num: 100, activityType_code: 'RDEL', actual_date: null, TripMaster_id: 55 },
      ]
      const dto = baseDto({
        id: 55,
        shipments: [
          trippedShipment(100, [
            { id: 1, ActivityType_code: 'LOAD', activityType: { code: 'LOAD' } },
          ]),
        ],
      })

      const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, existing)
      if (plan.kind !== 'plan') throw new Error(`expected plan, got: ${plan.error}`)
      expect(plan.removeIds).toEqual([2])
    })

    it("persists the planner's edited dates instead of the shipment's", () => {
      const existing: ExistingActivity[] = [
        { id: 1, order_num: 100, activityType_code: 'LOAD', actual_date: null, TripMaster_id: 55 },
      ]
      const dto = baseDto({
        id: 55,
        shipments: [
          trippedShipment(100, [
            {
              id: 1,
              ActivityType_code: 'LOAD',
              activityType: { code: 'LOAD' },
              planned_start: '2026-06-09',
              planned_end: '2026-06-10',
            },
          ]),
        ],
      })

      const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, existing)
      if (plan.kind !== 'plan') throw new Error(`expected plan, got: ${plan.error}`)
      // shipment.load_date2 is 2026-06-02; the planner moved the activity to 06-09.
      // Same calendar day, now written as explicit naive midnight (date-only contract).
      expect(plan.activitiesToUpdate[0]!.fields['planned_start']).toBe('2026-06-09 00:00:00')
      expect(plan.activitiesToUpdate[0]!.fields['planned_end']).toBe('2026-06-10 00:00:00')
    })

    it('carries actual dates into the summary set the trip header is rolled up from', () => {
      const dto = baseDto({
        id: 55,
        shipments: [
          trippedShipment(100, [
            {
              id: 1,
              ActivityType_code: 'LOAD',
              activityType: { code: 'LOAD' },
              actual_date: '2026-06-02',
            },
          ]),
        ],
      })
      const plan = computeTripSavePlan(dto, { driver_id: 9, dispatcher_id: 5 }, [])
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.finalActivities.map((a) => a['actual_date'])).toEqual(['2026-06-02'])
    })

    it('auto-fills the required templates for a shipment sent without activities', () => {
      const plan = computeTripSavePlan(baseDto(), null, [])
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.activitiesToAdd.map((a) => a['ActivityType_code']).sort()).toEqual([
        'LOAD',
        'PACK',
        'RDEL',
      ])
    })

    it('auto-fills for a shipment sent with an empty activities array', () => {
      const plan = computeTripSavePlan(
        baseDto({ shipments: [{ ...shipment(100), activities: [] }] }),
        null,
        [],
      )
      if (plan.kind !== 'plan') throw new Error('expected plan')
      expect(plan.activitiesToAdd).toHaveLength(3)
    })
  })

  // Trip save writes the same four calendar-day columns as the activity PATCH,
  // so it needs the same contract — otherwise a save re-persists the 05:00
  // timestamps the pickers produced. See lib/longhaul-date-only.
  describe('date-only columns', () => {
    const withActivity = (fields: Record<string, unknown>) =>
      baseDto({
        id: 55,
        shipments: [
          {
            ...shipment(100),
            activities: [
              {
                order_num: 100,
                TripMaster_id: 55,
                ActivityType_code: 'SITIN',
                activityType: { code: 'SITIN' },
                ...fields,
              },
            ],
          },
        ],
      })

    it('normalizes dates on an ADDED activity', () => {
      const plan = computeTripSavePlan(
        withActivity({ estimated_date: '2026-08-16T05:00:00.000Z', planned_start: '2026-08-16' }),
        { driver_id: 9, dispatcher_id: 5 },
        [],
      )
      if (plan.kind !== 'plan') throw new Error(`expected plan, got ${plan.error}`)
      const added = plan.activitiesToAdd.find((a) => a['ActivityType_code'] === 'SITIN')!
      expect(added['estimated_date']).toBe('2026-08-16 00:00:00')
      expect(added['planned_start']).toBe('2026-08-16 00:00:00')
    })

    it('normalizes dates on an UPDATED activity', () => {
      const existing: ExistingActivity[] = [
        { id: 8, order_num: 100, activityType_code: 'SITIN', actual_date: null, TripMaster_id: 55 },
      ]
      const plan = computeTripSavePlan(
        withActivity({ id: 8, actual_date: '2026-08-10T05:00:00.000Z' }),
        { driver_id: 9, dispatcher_id: 5 },
        existing,
      )
      if (plan.kind !== 'plan') throw new Error(`expected plan, got ${plan.error}`)
      const upd = plan.activitiesToUpdate.find((u) => u.id === 8)!
      expect(upd.fields['actual_date']).toBe('2026-08-10 00:00:00')
    })

    // A plan date may legitimately fall outside the date spread, so an inverted
    // planned span must save. Rejecting it blocked 8 prod trips entirely.
    it('saves a legitimately inverted planned span', () => {
      const plan = computeTripSavePlan(
        withActivity({
          planned_start: '2021-03-19T00:00:00.000Z',
          planned_end: '2021-03-01T00:00:00.000Z',
        }),
        { driver_id: 9, dispatcher_id: 5 },
        [],
      )
      if (plan.kind !== 'plan') throw new Error(`expected plan, got ${plan.error}`)
      const added = plan.activitiesToAdd.find((a) => a['ActivityType_code'] === 'SITIN')!
      expect(added['planned_start']).toBe('2021-03-19 00:00:00')
      expect(added['planned_end']).toBe('2021-03-01 00:00:00')
    })

    it('rejects a sentinel year rather than persisting it', () => {
      const plan = computeTripSavePlan(
        withActivity({ planned_start: '1969-12-17T00:00:00.000Z' }),
        { driver_id: 9, dispatcher_id: 5 },
        [],
      )
      expect(plan).toMatchObject({ kind: 'error', code: 'VALIDATION_ERROR' })
    })

    it('leaves a normal forward span alone', () => {
      const plan = computeTripSavePlan(
        withActivity({ planned_start: '2026-08-20', planned_end: '2026-08-25' }),
        { driver_id: 9, dispatcher_id: 5 },
        [],
      )
      expect(plan.kind).toBe('plan')
    })
  })

  describe('arrival window', () => {
    const withActivity = (fields: Record<string, unknown>) =>
      baseDto({
        id: 55,
        shipments: [
          {
            ...shipment(100),
            activities: [
              {
                order_num: 100,
                TripMaster_id: 55,
                ActivityType_code: 'SITIN',
                activityType: { code: 'SITIN' },
                planned_start: '2026-08-20',
                ...fields,
              },
            ],
          },
        ],
      })

    const plan = (fields: Record<string, unknown>) =>
      computeTripSavePlan(withActivity(fields), { driver_id: 9, dispatcher_id: 5 }, [])

    it('carries a valid window through to the write', () => {
      const result = plan({
        arrival_window_start: '08:00',
        arrival_window_end: '10:00',
        arrival_window_tz: 'America/New_York',
      })
      expect(result.kind).toBe('plan')
      expect(
        (result as { activitiesToAdd: Array<Record<string, unknown>> }).activitiesToAdd,
      ).toContainEqual(
        expect.objectContaining({
          arrival_window_start: '08:00',
          arrival_window_tz: 'America/New_York',
        }),
      )
    })

    it('rejects a window with no zone rather than writing half of one', () => {
      expect(plan({ arrival_window_start: '08:00', arrival_window_end: '10:00' })).toMatchObject({
        kind: 'error',
        code: 'VALIDATION_ERROR',
      })
    })

    it('rejects an over-wide time BEFORE it can overflow varchar(5)', () => {
      // A client still holding 'HH:mm:ss' would otherwise truncate at the
      // column and fail the whole atomic batch with an opaque 500.
      expect(
        plan({
          arrival_window_start: '08:00:00',
          arrival_window_end: '10:00:00',
          arrival_window_tz: 'America/New_York',
        }),
      ).toMatchObject({ kind: 'error', code: 'VALIDATION_ERROR' })
    })

    it('names the offending activity so a multi-shipment save is diagnosable', () => {
      const result = plan({ arrival_window_start: '08:00', arrival_window_end: '10:00' })
      expect((result as { error: string }).error).toContain('SITIN')
      expect((result as { error: string }).error).toContain('100')
    })

    it('leaves an activity with no window alone', () => {
      expect(plan({}).kind).toBe('plan')
    })

    it('still reports a bad window on an activity carrying neither code nor order', () => {
      // An API client can post a bare activity. The message has to degrade to
      // something readable rather than "undefined on order undefined".
      const result = computeTripSavePlan(
        baseDto({
          id: 55,
          shipments: [
            {
              ...shipment(100),
              activities: [{ arrival_window_start: '08:00', arrival_window_end: '10:00' }],
            },
          ],
        }),
        { driver_id: 9, dispatcher_id: 5 },
        [],
      )
      expect(result).toMatchObject({ kind: 'error', code: 'VALIDATION_ERROR' })
      expect((result as { error: string }).error).toContain('activity on order ?')
    })
  })
})
