/**
 * Unit tests for the `tripPlanning` slice.
 *
 * Slice key in store: `tripPlanning` (see `../store.ts`).
 *
 * Strategy: drive the slice's exported reducer directly with synthetic state +
 * action objects. No store, no provider, no React. Pure functions in, pure
 * state out.
 *
 * Bugs found while writing these tests are cataloged in
 * `plans/in-progress/longhaul-test-notes/unit-10-redux-trip-planning-bugs.md`.
 * Every assertion below is testing the **current** (sometimes buggy) behavior
 * so that the upcoming refactor has a tripwire if it accidentally changes
 * something.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import reducer, {
  addShipmentToTrip,
  removeShipmentFromTrip,
  editTrip,
  removeActivity,
  editActivity,
  addActivity,
  swapOrder,
  saveTripRequest,
  saveTripSuccess,
  saveTripFailure,
  setTrip,
  setSelectedTripIndex,
  createNewTrip,
  saveTrip,
  initializeTripPage,
  cancelTrip,
  type TripPlanningState,
} from './index'

// ----- Mocks for thunk dependencies ------------------------------------------------

vi.mock('../../utils/api', () => ({
  API: {
    saveTrip: vi.fn(),
    fetchTrip: vi.fn(),
    cancelTrip: vi.fn(),
  },
}))

vi.mock('../../utils/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../components/Snackbar/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notify: vi.fn(),
  registerSnackbarPush: vi.fn(),
}))

import { API } from '../../utils/api'
import logger from '../../utils/logger'
import { notifyError } from '../../components/Snackbar/notify'

// ----- Fixtures --------------------------------------------------------------------

const makeInitialState = (): TripPlanningState => ({
  trip: {
    name: null,
    driver: null,
    shipments: [],
    status: { id: 1, status_id: 1, status: 'Pending' },
  },
  unsavedTrip: null,
  shipmentToTrips: {},
})

const makeShipment = (overrides: Record<string, unknown> = {}) => ({
  order_num: 'ORDER-1',
  activities: [
    { id: 'a1', activityType: { sequencePriority: 1 } },
    { id: 'a2', activityType: { sequencePriority: 2 } },
  ],
  extraActivities: [],
  ...overrides,
})

const seedStateWithShipment = (
  shipmentOverrides: Record<string, unknown> = {},
  selectedTripIndex: any = 0,
  tripName = 'Trip A',
): TripPlanningState => {
  const shipment = makeShipment(shipmentOverrides)
  return {
    trip: {
      name: tripName,
      driver: null,
      shipments: [shipment],
      status: { id: 1, status_id: 1, status: 'Pending' },
    },
    unsavedTrip: null,
    selectedTripIndex,
    shipmentToTrips: {
      [shipment.order_num as string]: { [String(selectedTripIndex)]: tripName },
    },
  }
}

// ====================================================================================
//  REDUCERS
// ====================================================================================

describe('tripPlanning slice — reducer (pure)', () => {
  describe('initial state', () => {
    it('returns the documented initial state when given undefined + a no-op action', () => {
      const state = reducer(undefined, { type: '@@INIT' })
      expect(state).toEqual({
        trip: {
          name: null,
          driver: null,
          shipments: [],
          status: { id: 1, status_id: 1, status: 'Pending' },
        },
        unsavedTrip: null,
        shipmentToTrips: {},
      })
    })

    it('returns the same state for unknown actions', () => {
      const initial = makeInitialState()
      const next = reducer(initial, { type: 'some/random/thing' })
      expect(next).toEqual(initial)
    })

    it('does not mutate the state passed in (immer produces a draft)', () => {
      const initial = makeInitialState()
      const snapshot = JSON.parse(JSON.stringify(initial))
      reducer(initial, { type: 'noop' })
      expect(initial).toEqual(snapshot)
    })
  })

  // ----- addShipmentToTrip ---------------------------------------------------------

  describe('addShipmentToTrip', () => {
    it('appends a shipment to trip.shipments', () => {
      const state = makeInitialState()
      state.selectedTripIndex = 0
      state.trip.name = 'My Trip'
      const shipment = makeShipment({ order_num: 'O-1' })

      const next = reducer(state, addShipmentToTrip(shipment))

      expect(next.trip.shipments).toHaveLength(1)
      expect(next.trip.shipments[0]).toEqual(shipment)
    })

    it('records the shipment->trip mapping by selectedTripIndex', () => {
      const state = makeInitialState()
      state.selectedTripIndex = 2
      state.trip.name = 'Tuesday Run'
      const shipment = makeShipment({ order_num: 'O-2' })

      const next = reducer(state, addShipmentToTrip(shipment))

      expect(next.shipmentToTrips['O-2']).toBeDefined()
      expect(next.shipmentToTrips['O-2'][2]).toBe('Tuesday Run')
    })

    it('initializes shipmentToTrips[orderNum] to {} on first add', () => {
      const state = makeInitialState()
      state.selectedTripIndex = 0
      state.trip.name = 'X'
      const shipment = makeShipment({ order_num: 'NEW' })

      const next = reducer(state, addShipmentToTrip(shipment))

      expect(next.shipmentToTrips['NEW']).toBeTypeOf('object')
    })

    it('does not duplicate the shipment if already mapped for this trip index', () => {
      const initial = seedStateWithShipment({}, 0, 'Trip A')
      // current state: ORDER-1 is already mapped at index 0 -> 'Trip A'
      const next = reducer(initial, addShipmentToTrip(makeShipment()))

      expect(next.trip.shipments).toHaveLength(1)
    })

    it('adds the shipment to a different trip index even when mapped elsewhere', () => {
      const initial = seedStateWithShipment({}, 0, 'Trip A')
      // pretend the user switched to a different tab
      initial.selectedTripIndex = 1
      initial.trip.name = 'Trip B'
      // Reuse the same order_num but at index 1
      const next = reducer(initial, addShipmentToTrip(makeShipment()))

      // shipments array gets a second entry (one per trip-index slot)
      expect(next.trip.shipments).toHaveLength(2)
      expect(next.shipmentToTrips['ORDER-1'][0]).toBe('Trip A')
      expect(next.shipmentToTrips['ORDER-1'][1]).toBe('Trip B')
    })

    it('dedupes even when trip.name is null (regression: bug #3)', () => {
      // Before the fix: state.trip.name === null was written into shipmentToTrips,
      // so the dedup check `!shipmentToTrips[orderNum][index]` saw `!null` -> true,
      // causing the same shipment to be re-added on every dispatch.
      const state = makeInitialState() // trip.name === null
      state.selectedTripIndex = 0
      const shipment = makeShipment({ order_num: 'DUP' })

      let next = reducer(state, addShipmentToTrip(shipment))
      next = reducer(next, addShipmentToTrip(shipment))
      next = reducer(next, addShipmentToTrip(shipment))

      expect(next.trip.shipments).toHaveLength(1)
      // sentinel is `true` (the `?? true` fallback) because trip.name is null
      expect(next.shipmentToTrips['DUP'][0]).toBe(true)
    })
  })

  // ----- removeShipmentFromTrip -----------------------------------------------------

  describe('removeShipmentFromTrip', () => {
    it('removes the shipment at the given index', () => {
      const state = seedStateWithShipment({ order_num: 'O-Z' }, 0, 'T')
      const next = reducer(state, removeShipmentFromTrip(0))
      expect(next.trip.shipments).toHaveLength(0)
    })

    it('clears the shipmentToTrips mapping for the removed shipment + index', () => {
      const state = seedStateWithShipment({ order_num: 'O-Z' }, 0, 'T')
      const next = reducer(state, removeShipmentFromTrip(0))
      expect(next.shipmentToTrips['O-Z']?.[0]).toBeUndefined()
    })

    it('preserves other shipments around the removed index', () => {
      const a = makeShipment({ order_num: 'A' })
      const b = makeShipment({ order_num: 'B' })
      const c = makeShipment({ order_num: 'C' })
      const state: TripPlanningState = {
        trip: {
          name: 'T',
          driver: null,
          shipments: [a, b, c],
          status: { id: 1, status_id: 1, status: 'Pending' },
        },
        unsavedTrip: null,
        selectedTripIndex: 0,
        shipmentToTrips: {
          A: { 0: 'T' },
          B: { 0: 'T' },
          C: { 0: 'T' },
        },
      }
      const next = reducer(state, removeShipmentFromTrip(1))
      expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['A', 'C'])
      expect(next.shipmentToTrips.B[0]).toBeUndefined()
      expect(next.shipmentToTrips.A[0]).toBe('T')
      expect(next.shipmentToTrips.C[0]).toBe('T')
    })

    it('tolerates a shipment that has no shipmentToTrips entry (just splices)', () => {
      const a = makeShipment({ order_num: 'NO-MAP' })
      const state: TripPlanningState = {
        trip: {
          name: 'T',
          driver: null,
          shipments: [a],
          status: {},
        },
        unsavedTrip: null,
        selectedTripIndex: 0,
        shipmentToTrips: {},
      }
      const next = reducer(state, removeShipmentFromTrip(0))
      expect(next.trip.shipments).toHaveLength(0)
    })

    it('is a no-op when index is out of range (regression: bug #4)', () => {
      // Before the fix: removeShipmentFromTrip(99) on a short array dereferenced
      // `shipment.order_num` on undefined and threw.
      const a = makeShipment({ order_num: 'A' })
      const state: TripPlanningState = {
        trip: {
          name: 'T',
          driver: null,
          shipments: [a],
          status: {},
        },
        unsavedTrip: null,
        selectedTripIndex: 0,
        shipmentToTrips: { A: { 0: 'T' } },
      }
      expect(() => reducer(state, removeShipmentFromTrip(99))).not.toThrow()
      const next = reducer(state, removeShipmentFromTrip(99))
      expect(next.trip.shipments).toHaveLength(1)
      expect(next.shipmentToTrips.A[0]).toBe('T')
    })

    it('is a no-op when the shipments array is empty', () => {
      const state = makeInitialState()
      expect(() => reducer(state, removeShipmentFromTrip(0))).not.toThrow()
    })
  })

  // ----- editTrip -------------------------------------------------------------------

  describe('editTrip', () => {
    it('shallow-merges the payload into state.trip', () => {
      const state = makeInitialState()
      state.trip.name = 'old-name'
      const next = reducer(state, editTrip({ name: 'new-name', driver_id: 9 }))
      expect(next.trip.name).toBe('new-name')
      expect(next.trip.driver_id).toBe(9)
      // unrelated fields preserved
      expect(next.trip.status).toEqual({ id: 1, status_id: 1, status: 'Pending' })
    })

    it('overwrites shipments wholesale when payload includes them', () => {
      const initial = seedStateWithShipment({ order_num: 'OLD' }, 0, 'T')
      const next = reducer(initial, editTrip({ shipments: [] }))
      expect(next.trip.shipments).toEqual([])
      // BUG NOTE: shipmentToTrips is NOT cleared in sync — see bugs.md item #6
      expect(next.shipmentToTrips.OLD).toBeDefined()
    })

    it('is a no-op when payload is undefined', () => {
      const state = makeInitialState()
      state.trip.name = 'kept'
      const next = reducer(state, editTrip(undefined))
      expect(next.trip.name).toBe('kept')
    })
  })

  // ----- removeActivity -------------------------------------------------------------

  describe('removeActivity', () => {
    it('removes the activity at activityIndex and pushes it onto extraActivities', () => {
      const state = seedStateWithShipment({}, 0, 'T')
      // shipment has 2 activities
      const next = reducer(state, removeActivity({ shipmentIndex: 0, activityIndex: 0 }))
      expect(next.trip.shipments[0].activities).toHaveLength(1)
      expect(next.trip.shipments[0].activities[0].id).toBe('a2')
      expect(next.trip.shipments[0].extraActivities).toHaveLength(1)
      expect(next.trip.shipments[0].extraActivities[0].id).toBe('a1')
    })

    it('removes the entire shipment when its last activity is removed', () => {
      const state = seedStateWithShipment(
        {
          activities: [{ id: 'only', activityType: { sequencePriority: 1 } }],
        },
        0,
        'T',
      )
      const next = reducer(state, removeActivity({ shipmentIndex: 0, activityIndex: 0 }))
      expect(next.trip.shipments).toHaveLength(0)
      expect(next.shipmentToTrips['ORDER-1']?.[0]).toBeUndefined()
    })

    it('is a no-op when shipmentIndex is out of range (regression: bug #5)', () => {
      const state = seedStateWithShipment({}, 0, 'T')
      expect(() =>
        reducer(state, removeActivity({ shipmentIndex: 99, activityIndex: 0 })),
      ).not.toThrow()
      const next = reducer(state, removeActivity({ shipmentIndex: 99, activityIndex: 0 }))
      expect(next.trip.shipments).toHaveLength(1)
    })

    it('initializes extraActivities lazily when undefined (regression: bug #5)', () => {
      // Shipment has 2 activities but no extraActivities array at all.
      const state = seedStateWithShipment(
        {
          activities: [
            { id: 'a1', activityType: { sequencePriority: 1 } },
            { id: 'a2', activityType: { sequencePriority: 2 } },
          ],
          extraActivities: undefined,
        },
        0,
        'T',
      )
      expect(() =>
        reducer(state, removeActivity({ shipmentIndex: 0, activityIndex: 0 })),
      ).not.toThrow()
      const next = reducer(state, removeActivity({ shipmentIndex: 0, activityIndex: 0 }))
      expect(next.trip.shipments[0].activities).toHaveLength(1)
      expect(next.trip.shipments[0].extraActivities).toHaveLength(1)
      expect(next.trip.shipments[0].extraActivities[0].id).toBe('a1')
    })

    it('tolerates a missing shipmentToTrips entry when removing the only activity (regression: bug #5)', () => {
      // Shipment exists in state.trip.shipments but isn't tracked in shipmentToTrips
      // (e.g. test fixture or stale state). Previous code: `delete state.shipmentToTrips[shipment.order_num][...]`
      // would throw with "Cannot read properties of undefined".
      const shipment = makeShipment({
        order_num: 'UNMAPPED',
        activities: [{ id: 'solo', activityType: { sequencePriority: 1 } }],
      })
      const state: TripPlanningState = {
        trip: {
          name: 'T',
          driver: null,
          shipments: [shipment],
          status: {},
        },
        unsavedTrip: null,
        selectedTripIndex: 0,
        shipmentToTrips: {}, // no entry for UNMAPPED
      }
      expect(() =>
        reducer(state, removeActivity({ shipmentIndex: 0, activityIndex: 0 })),
      ).not.toThrow()
      const next = reducer(state, removeActivity({ shipmentIndex: 0, activityIndex: 0 }))
      expect(next.trip.shipments).toHaveLength(0)
    })
  })

  // ----- editActivity ---------------------------------------------------------------

  describe('editActivity', () => {
    it('shallow-merges partialActivity into the targeted activity', () => {
      const state = seedStateWithShipment({}, 0, 'T')
      const next = reducer(
        state,
        editActivity({
          shipmentIndex: 0,
          activityIndex: 1,
          partialActivity: { note: 'hello', id: 'a2' },
        }),
      )
      expect(next.trip.shipments[0].activities[1]).toMatchObject({
        id: 'a2',
        note: 'hello',
        activityType: { sequencePriority: 2 },
      })
    })

    it('does not affect the other activity', () => {
      const state = seedStateWithShipment({}, 0, 'T')
      const next = reducer(
        state,
        editActivity({
          shipmentIndex: 0,
          activityIndex: 1,
          partialActivity: { foo: 'bar' },
        }),
      )
      expect(next.trip.shipments[0].activities[0]).toEqual({
        id: 'a1',
        activityType: { sequencePriority: 1 },
      })
    })
  })

  // ----- addActivity ----------------------------------------------------------------

  describe('addActivity', () => {
    it('appends the new activity and sorts by sequencePriority', () => {
      const state = seedStateWithShipment(
        {
          activities: [
            { id: 'first', activityType: { sequencePriority: 1 } },
            { id: 'third', activityType: { sequencePriority: 3 } },
          ],
          extraActivities: [{ id: 'middle', activityType: { sequencePriority: 2 } }],
        },
        0,
        'T',
      )

      const next = reducer(
        state,
        addActivity({
          shipmentIndex: 0,
          activity: { id: 'middle', activityType: { sequencePriority: 2 } },
          activityIdx: 0,
        }),
      )

      const ids = next.trip.shipments[0].activities.map((a: any) => a.id)
      expect(ids).toEqual(['first', 'middle', 'third'])
    })

    it('removes the chosen entry from extraActivities (delete leaves a hole)', () => {
      const state = seedStateWithShipment(
        {
          extraActivities: [
            { id: 'x0', activityType: { sequencePriority: 0 } },
            { id: 'x1', activityType: { sequencePriority: 4 } },
          ],
        },
        0,
        'T',
      )
      const next = reducer(
        state,
        addActivity({
          shipmentIndex: 0,
          activity: { id: 'x0', activityType: { sequencePriority: 0 } },
          activityIdx: 0,
        }),
      )
      // `delete arr[0]` does not shift; index 1 remains, index 0 becomes empty.
      // Immer turns the deleted slot into `undefined`.
      expect(next.trip.shipments[0].extraActivities[0]).toBeUndefined()
      expect(next.trip.shipments[0].extraActivities[1]).toEqual({
        id: 'x1',
        activityType: { sequencePriority: 4 },
      })
    })
  })

  // ----- swapOrder ------------------------------------------------------------------

  describe('swapOrder', () => {
    const buildShipments = () => [
      makeShipment({ order_num: 'A' }),
      makeShipment({ order_num: 'B' }),
      makeShipment({ order_num: 'C' }),
    ]

    it('moves a shipment up by one (up: true)', () => {
      const state: TripPlanningState = {
        ...makeInitialState(),
        trip: {
          ...makeInitialState().trip,
          shipments: buildShipments(),
        },
      }
      const next = reducer(state, swapOrder({ from: 1, up: true }))
      expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['B', 'A', 'C'])
    })

    it('moves a shipment down by one (up: false)', () => {
      const state: TripPlanningState = {
        ...makeInitialState(),
        trip: {
          ...makeInitialState().trip,
          shipments: buildShipments(),
        },
      }
      const next = reducer(state, swapOrder({ from: 1, up: false }))
      expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['A', 'C', 'B'])
    })

    describe('swapOrder edge cases (bounds-checked — see bugs.md #9)', () => {
      it('"up" on the first shipment is a no-op (cannot move past the top edge)', () => {
        const state: TripPlanningState = {
          ...makeInitialState(),
          trip: {
            ...makeInitialState().trip,
            shipments: buildShipments(),
          },
        }
        const next = reducer(state, swapOrder({ from: 0, up: true }))
        expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['A', 'B', 'C'])
      })

      it('"down" on the last shipment is a no-op (cannot move past the bottom edge)', () => {
        const state: TripPlanningState = {
          ...makeInitialState(),
          trip: {
            ...makeInitialState().trip,
            shipments: buildShipments(),
          },
        }
        const next = reducer(state, swapOrder({ from: 2, up: false }))
        expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['A', 'B', 'C'])
      })

      it('"up" on the last shipment moves it toward the top', () => {
        const state: TripPlanningState = {
          ...makeInitialState(),
          trip: {
            ...makeInitialState().trip,
            shipments: buildShipments(),
          },
        }
        const next = reducer(state, swapOrder({ from: 2, up: true }))
        expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['A', 'C', 'B'])
      })

      it('"down" on the first shipment moves it toward the bottom', () => {
        const state: TripPlanningState = {
          ...makeInitialState(),
          trip: {
            ...makeInitialState().trip,
            shipments: buildShipments(),
          },
        }
        const next = reducer(state, swapOrder({ from: 0, up: false }))
        expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['B', 'A', 'C'])
      })

      it('is a no-op when `from` is out of range and does not throw', () => {
        const state: TripPlanningState = {
          ...makeInitialState(),
          trip: {
            ...makeInitialState().trip,
            shipments: buildShipments(),
          },
        }
        expect(() => reducer(state, swapOrder({ from: 99, up: true }))).not.toThrow()
        const next = reducer(state, swapOrder({ from: 99, up: false }))
        expect(next.trip.shipments.map((s: any) => s.order_num)).toEqual(['A', 'B', 'C'])
      })
    })
  })

  // ----- save lifecycle -------------------------------------------------------------

  describe('saveTripRequest / Success / Failure', () => {
    it('saveTripRequest sets loading=true', () => {
      const state = makeInitialState()
      const next = reducer(state, saveTripRequest())
      expect(next.loading).toBe(true)
    })

    it('saveTripSuccess sets loading=false and trip.id', () => {
      const state = makeInitialState()
      state.loading = true
      const next = reducer(state, saveTripSuccess({ id: 42 }))
      expect(next.loading).toBe(false)
      expect(next.trip.id).toBe(42)
    })

    it('saveTripFailure sets loading=false and stores the error', () => {
      const state = makeInitialState()
      state.loading = true
      const err = new Error('boom')
      const next = reducer(state, saveTripFailure(err))
      expect(next.loading).toBe(false)
      expect(next.error).toBe(err)
    })

    it('lifecycle is composable: request -> success transitions loading correctly', () => {
      let s = reducer(makeInitialState(), saveTripRequest())
      expect(s.loading).toBe(true)
      s = reducer(s, saveTripSuccess({ id: 1 }))
      expect(s.loading).toBe(false)
      expect(s.trip.id).toBe(1)
    })

    it('lifecycle: request -> failure transitions loading correctly', () => {
      let s = reducer(makeInitialState(), saveTripRequest())
      expect(s.loading).toBe(true)
      s = reducer(s, saveTripFailure({ message: 'nope' }))
      expect(s.loading).toBe(false)
      expect(s.error).toEqual({ message: 'nope' })
    })
  })

  // ----- setTrip --------------------------------------------------------------------

  describe('setTrip', () => {
    it('replaces state.trip and assigns unsavedTrip', () => {
      const state = makeInitialState()
      const payload = {
        id: 7,
        name: 'Imported',
        driver: { id: 1 },
        shipments: [],
        driver_id: 99,
      }
      const next = reducer(state, setTrip(payload))
      expect(next.trip).toMatchObject({ id: 7, name: 'Imported', driver_id: 99 })
      expect(next.unsavedTrip).toBe(next.trip)
    })

    it('coerces driver_id to null when not provided in payload', () => {
      const state = makeInitialState()
      const next = reducer(state, setTrip({ id: 1, name: 'X', driver: null, shipments: [] }))
      expect(next.trip.driver_id).toBeNull()
    })

    it('rebuilds shipmentToTrips from payload.shipments', () => {
      const state = makeInitialState()
      state.selectedTripIndex = 0
      state.shipmentToTrips = { STALE: { 0: 'old' } }
      const next = reducer(
        state,
        setTrip({
          id: 1,
          name: 'Imported',
          driver_id: 1,
          shipments: [makeShipment({ order_num: 'IMP-1' }), makeShipment({ order_num: 'IMP-2' })],
        }),
      )
      expect(next.shipmentToTrips.STALE).toBeUndefined()
      expect(next.shipmentToTrips['IMP-1']).toBeDefined()
      expect(next.shipmentToTrips['IMP-2']).toBeDefined()
    })

    it('handles an empty shipments array without throwing', () => {
      const state = makeInitialState()
      const next = reducer(state, setTrip({ id: 1, name: 'Empty', driver_id: 1, shipments: [] }))
      expect(next.shipmentToTrips).toEqual({})
    })

    it('coerces a missing shipments key to [] without throwing (regression: bug #8)', () => {
      // Before the fix: `.forEach` on undefined threw.
      const state = makeInitialState()
      expect(() => reducer(state, setTrip({ id: 1, name: 'x' }))).not.toThrow()
      const next = reducer(state, setTrip({ id: 1, name: 'x' }))
      expect(next.shipmentToTrips).toEqual({})
      expect(next.trip.id).toBe(1)
    })

    it('coerces a null shipments value to [] without throwing (regression: bug #8)', () => {
      const state = makeInitialState()
      expect(() => reducer(state, setTrip({ id: 2, name: 'y', shipments: null }))).not.toThrow()
      const next = reducer(state, setTrip({ id: 2, name: 'y', shipments: null }))
      expect(next.shipmentToTrips).toEqual({})
    })
  })

  // ----- setSelectedTripIndex / createNewTrip ---------------------------------------

  describe('setSelectedTripIndex / createNewTrip', () => {
    it('setSelectedTripIndex writes the index to state.selectedTripIndex', () => {
      const state = makeInitialState()
      const next = reducer(state, setSelectedTripIndex(2))
      expect(next.selectedTripIndex).toBe(2)
      // trip is untouched
      expect(next.trip).toEqual(state.trip)
    })

    it('createNewTrip resets trip, unsavedTrip, shipmentToTrips, and selectedTripIndex', () => {
      const state = makeInitialState()
      state.trip = {
        ...state.trip,
        name: 'leftover',
        driver: { id: 5 },
        shipments: [{ order_num: '1' }],
      }
      state.unsavedTrip = { name: 'unsaved' }
      state.shipmentToTrips = { '1': { '0': 'leftover' } }
      state.selectedTripIndex = 3
      const next = reducer(state, createNewTrip())
      expect(next.trip.name).toBeNull()
      expect(next.trip.driver).toBeNull()
      expect(next.trip.shipments).toEqual([])
      expect(next.trip.status).toEqual({ id: 1, status_id: 1, status: 'Pending' })
      expect(next.unsavedTrip).toBeNull()
      expect(next.shipmentToTrips).toEqual({})
      expect(next.selectedTripIndex).toBeUndefined()
    })
  })
})

// ====================================================================================
//  THUNKS
// ====================================================================================

describe('tripPlanning slice — thunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ----- saveTrip -------------------------------------------------------------------

  describe('saveTrip', () => {
    it('dispatches request → success → setTrip and returns the saved id', async () => {
      const dispatch = vi.fn()
      ;(API.saveTrip as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 99 })

      const tripInput = { name: 'X', shipments: [], driver: null }
      const id = await saveTrip(tripInput)(dispatch as any)

      expect(id).toBe(99)
      expect(dispatch).toHaveBeenCalledTimes(3)
      // First call: saveTripRequest
      expect(dispatch.mock.calls[0][0]).toMatchObject({
        type: 'tripPlanning/saveTripRequest',
      })
      // Second call: saveTripSuccess
      expect(dispatch.mock.calls[1][0]).toMatchObject({
        type: 'tripPlanning/saveTripSuccess',
        payload: { id: 99 },
      })
      // Third call: setTrip with merged payload
      expect(dispatch.mock.calls[2][0]).toMatchObject({
        type: 'tripPlanning/setTrip',
      })
      expect(dispatch.mock.calls[2][0].payload).toMatchObject({
        id: 99,
        name: 'X',
        shipments: [],
      })
    })

    it('propagates rejections from API.saveTrip (no Failure dispatch in current code)', async () => {
      const dispatch = vi.fn()
      ;(API.saveTrip as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'))

      await expect(saveTrip({ name: 'fails' })(dispatch as any)).rejects.toThrow('network')

      // saveTripRequest is dispatched, but neither success nor failure is.
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][0].type).toBe('tripPlanning/saveTripRequest')
    })
  })

  // ----- initializeTripPage --------------------------------------------------------

  describe('initializeTripPage', () => {
    it('dispatches setTrip with a fresh pending trip when no tripId is given', async () => {
      const dispatch = vi.fn()
      const user = { code: 'u-1', name: 'Alice' }

      await initializeTripPage(null, user)(dispatch as any)

      expect(dispatch).toHaveBeenCalledTimes(1)
      const action = dispatch.mock.calls[0][0]
      expect(action.type).toBe('tripPlanning/setTrip')
      expect(action.payload).toMatchObject({
        trip_title: 'Pending Trip',
        driver: null,
        shipments: [],
        created_by_id: 'u-1',
        dispatcher: user,
        status: { id: 1, status_id: 1, status: 'Pending' },
      })
    })

    it('fetches the trip and dispatches setTrip with updated_by_id when tripId is given', async () => {
      const dispatch = vi.fn()
      const user = { code: 'u-2' }
      ;(API.fetchTrip as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 5,
        name: 'Existing',
        shipments: [],
      })

      await initializeTripPage(5, user)(dispatch as any)

      expect(API.fetchTrip).toHaveBeenCalledWith(5)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][0].payload).toMatchObject({
        id: 5,
        updated_by_id: 'u-2',
      })
    })

    it('on fetch failure: logs original error, dispatches setError, and surfaces notifyError', async () => {
      const dispatch = vi.fn()
      ;(API.fetchTrip as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))

      await initializeTripPage(5, { code: 'u' })(dispatch as any)

      // logger still receives the original error for the debug trail
      expect(logger.error).toHaveBeenCalledTimes(1)
      const errArg = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(errArg).toBeInstanceOf(Error)

      // setError is dispatched with a properly-spelled message
      expect(dispatch).toHaveBeenCalledTimes(1)
      const action = dispatch.mock.calls[0][0]
      expect(action.type).toBe('tripPlanning/setError')
      expect(action.payload).toContain('error initializing')
      expect(action.payload).toContain('boom')

      // notifyError surfaces the same message to the user
      expect(notifyError).toHaveBeenCalledTimes(1)
      expect(notifyError).toHaveBeenCalledWith(action.payload)
    })

    it('on a rejection with no message: still surfaces a useful error', async () => {
      const dispatch = vi.fn()
      ;(API.fetchTrip as ReturnType<typeof vi.fn>).mockRejectedValue({})

      await initializeTripPage(5, { code: 'u' })(dispatch as any)

      expect(notifyError).toHaveBeenCalledTimes(1)
      const msg = (notifyError as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(msg).toBe('error initializing unknown error')
    })

    it('after a successful setError dispatch, reducer writes message to state.error', () => {
      // sanity check that the new setError reducer is wired correctly
      const state = makeInitialState()
      const next = reducer(state, {
        type: 'tripPlanning/setError',
        payload: 'error initializing boom',
      })
      expect(next.error).toBe('error initializing boom')
    })
  })

  // ----- cancelTrip ----------------------------------------------------------------

  describe('cancelTrip', () => {
    it('cancels via API then re-initializes a fresh pending trip', async () => {
      const dispatch = vi.fn().mockImplementation(async (a: any) => {
        if (typeof a === 'function') return a(dispatch)
        return a
      })
      ;(API.cancelTrip as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
      const user = { code: 'me' }

      await cancelTrip(123, user)(dispatch as any)

      expect(API.cancelTrip).toHaveBeenCalledWith(123)
      // First dispatch is the inner thunk (function), then setTrip is dispatched inside it.
      // We only assert the thunk was dispatched and didn't crash.
      expect(dispatch).toHaveBeenCalled()
    })

    it('logs and swallows errors from API.cancelTrip', async () => {
      const dispatch = vi.fn()
      ;(API.cancelTrip as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cancel-fail'))

      await cancelTrip(1, { code: 'x' })(dispatch as any)

      expect(logger.error).toHaveBeenCalledTimes(1)
      // No second dispatch because the inner re-init never runs.
      expect(dispatch).not.toHaveBeenCalled()
    })
  })
})
