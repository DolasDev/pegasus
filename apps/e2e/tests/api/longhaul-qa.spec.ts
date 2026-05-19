import { qaTest as test, expect } from '../../fixtures/qa'

// ---------------------------------------------------------------------------
// HTTP-level checks of the longhaul on-prem bridge against a real QA tenant.
//
// Only runs under E2E_TARGET=qa (the `qa-api` project) — it needs a deployed QA
// cloud API, a live WireGuard tunnel to the on-prem Dolios server, and a real
// Cognito token whose TenantUser has `legacyWindowsUsername` mapped to a valid
// Dolios user. Authentication uses the token captured by the `qa-setup` project
// (see fixtures/qa.ts → qaApiFetch).
//
// The cloud API exposes the longhaul bridge as a transparent proxy at
//   /api/v1/onprem/longhaul/*
// (see apps/api/src/handlers/onprem.ts), forwarding through the tunnel to the
// on-prem server's /api/v1/longhaul/*. That's the path the tenant-web app uses
// too (apps/tenant-web/src/api/queries/driver-planning.ts).
//
// Read-only checks are untagged; write round-trips are @qa-mutating (they write
// to the on-prem MSSQL DB — disposable in QA; re-seed from the known-good
// snapshot before a full run, see QA.md).
// ---------------------------------------------------------------------------

const LH = '/api/v1/onprem/longhaul'

// Mirror the UI's default planning-window query (see redux/shipments/index.ts
// + utils/api/routes.ts): the server's /shipments handler enriches every row
// before truncating at 1000, so an unfiltered query trips RESULT_LIMIT_EXCEEDED
// on the real QA DB. The on-prem filter handler reads `query.filters.*` (NESTED,
// not flat) — a flat top-level shape is silently ignored, returning everything.
const dateOffset = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const planningWindowQuery = (
  extras: Record<string, unknown> = {},
): { filters: Record<string, unknown>; sortBy: Record<string, unknown> } => ({
  filters: {
    Is_Trip_Planning: true,
    load_date: [dateOffset(-30), dateOffset(30)],
    ...extras,
  },
  sortBy: {},
})

test.describe('longhaul on-prem bridge (QA)', () => {
  // Canary: if the version ping fails, the tunnel/Dolios/MSSQL path is down —
  // skip the rest so the run output explains why rather than spewing failures.
  test.beforeEach(async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/version`)
    test.skip(
      res.status !== 200,
      `On-prem /version returned ${res.status} — QA tunnel → Dolios → MSSQL is not healthy.`,
    )
  })

  // Since Phase 1 of the longhaul strangler-fig migration, /version is served
  // cloud-direct (apps/api/src/handlers/longhaul-cloud/version.ts): the cloud
  // Hono Lambda queries Dolios MSSQL through the mssql-executor Lambda instead
  // of proxying to the on-prem server. The response shape must stay identical
  // to the on-prem handler — `{ data: { max } }`.
  test('GET /version returns version info @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/version`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data, 'cloud-direct /version returns { data: { max } }').toBeDefined()
    expect(body.data).toHaveProperty('max')
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /states is served
  // cloud-direct (apps/api/src/handlers/longhaul-cloud/states.ts): the cloud
  // Hono Lambda queries Dolios MSSQL through the mssql-executor Lambda instead
  // of proxying to the on-prem server. The response shape must stay identical
  // to the on-prem handler — `{ data: [...] }`.
  test('GET /states returns the states list @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/states`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data), 'cloud-direct /states returns { data: [...] }').toBe(true)
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /drivers is served
  // cloud-direct (apps/api/src/handlers/longhaul-cloud/drivers.ts): the cloud
  // Hono Lambda queries the Dolios `v_longhaul_drivers` view through the
  // mssql-executor Lambda instead of proxying to the on-prem server. The
  // response shape must stay identical to the on-prem handler — `{ data: [...] }`
  // with lowercase `driver_id` / `driver_name` keys.
  test('GET /drivers returns the cloud-direct driver list @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/drivers`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data), 'cloud-direct /drivers returns { data: [...] }').toBe(true)
    if (body.data.length > 0) {
      expect(body.data[0], 'driver rows expose lowercase keys').toHaveProperty('driver_id')
      expect(body.data[0]).toHaveProperty('driver_name')
    }
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /zones is served
  // cloud-direct (apps/api/src/handlers/longhaul-cloud/zones.ts): the cloud
  // Hono Lambda queries Dolios MSSQL (v_longhaul_zones) through the
  // mssql-executor Lambda instead of proxying to the on-prem server. The
  // response shape must stay identical to the on-prem handler — `{ data: [] }`.
  test('GET /zones returns a zones list @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/zones`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data ?? body), 'cloud-direct /zones returns { data: [] }').toBe(true)
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /planners is served
  // cloud-direct (apps/api/src/handlers/longhaul-cloud/planners.ts): the cloud
  // Hono Lambda queries Dolios MSSQL through the mssql-executor Lambda instead
  // of proxying to the on-prem server. The response shape must stay identical
  // to the on-prem handler — `{ data: [...] }`.
  test('GET /planners returns a planners list', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/planners`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data ?? body), 'cloud-direct /planners returns { data: [...] }').toBe(
      true,
    )
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /dispatchers is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/dispatchers.ts):
  // the cloud Hono Lambda queries v_longhaul_salesman through the
  // mssql-executor Lambda instead of proxying to the on-prem server. The
  // response shape must stay identical to the on-prem handler — `{ data: [] }`.
  test('GET /dispatchers returns the dispatcher list @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/dispatchers`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data ?? body), 'cloud-direct /dispatchers returns { data: [] }').toBe(
      true,
    )
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /activity-types is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/activity-types.ts):
  // the cloud Hono Lambda queries Dolios MSSQL through the mssql-executor Lambda
  // instead of proxying to the on-prem server. The response shape must stay
  // identical to the on-prem handler — `{ data: [...] }`.
  test('GET /activity-types returns the activity types list @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/activity-types`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(
      Array.isArray(body.data ?? body),
      'cloud-direct /activity-types returns { data: [...] }',
    ).toBe(true)
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /filter-options is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/filter-options.ts):
  // the cloud Hono Lambda queries the MoveType table in Dolios MSSQL through the
  // mssql-executor Lambda instead of proxying to the on-prem server. The response
  // shape must stay identical to the on-prem handler —
  // `{ data: { moveType: [{ value, label }, ...] } }`.
  test('GET /filter-options returns move type options @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/filter-options`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data, 'cloud-direct /filter-options returns { data }').toBeDefined()
    expect(Array.isArray(body.data.moveType), 'data.moveType is an array').toBe(true)
    for (const opt of body.data.moveType) {
      expect(opt).toHaveProperty('value')
      expect(opt).toHaveProperty('label')
    }
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /users/me is served
  // cloud-direct (apps/api/src/handlers/longhaul-cloud/users-me.ts): the cloud
  // Hono Lambda resolves the caller's legacy identity (TenantUser →
  // v_longhaul_salesman) through the mssql-executor Lambda instead of proxying
  // to the on-prem server. Response shape stays `{ data: <longhaul user> }`.
  // Phase 3 of the longhaul strangler-fig migration: the current user's default
  // shipment filter is served cloud-direct
  // (apps/api/src/handlers/longhaul-cloud/shipment-filters-default.ts). The
  // cloud Hono Lambda resolves the legacy user via the mssql-executor and reads
  // `longhaul_user_preferences` + `longhaul_shipment_filter` directly. Response
  // shape must stay identical to the on-prem handler — `{ data: ... }` where
  // data is null when no default filter is set.
  test('GET /shipment-filters/default returns the { data } shape', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/shipment-filters/default`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body, 'cloud-direct /shipment-filters/default returns { data }').toHaveProperty('data')
    // data is null when no default is set, otherwise the saved filter row.
    if (body.data !== null) {
      expect(typeof body.data).toBe('object')
    }
  })

  test('GET /users/me returns the mapped legacy user @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/users/me`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data, 'cloud-direct /users/me returns { data: <longhaul user> }').toBeTruthy()
    expect(body.data).toHaveProperty('code')
  })

  test('GET /shipments (bounded query) returns the {data,meta} shape', async ({ qaApiFetch }) => {
    // Use a searchTerm that matches nothing to bound the result set — the app
    // always sends a filter (Is_Trip_Planning + load_date window + assigned),
    // never an unfiltered scan. The browser /planning spec covers the real
    // filtered path returning actual shipments.
    const res = await qaApiFetch(`${LH}/shipments?searchTerm=zzz-no-such-shipment-zzz`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data ?? body)).toBe(true)
    if (body.meta) expect(typeof body.meta.count).toBe('number')
  })

  test('GET /shipments unfiltered does not 500 on a large DB', async ({ qaApiFetch }) => {
    // Regression guard: previously an unfiltered scan pulled the whole shipments
    // view and fed tens of thousands of order_nums into `.whereIn(...)`, blowing
    // SQL Server's 2100-parameter limit (observed @p193800+ → tedious "Maximum
    // call stack size exceeded" → 500). The repo now caps the base query, so a
    // too-broad query yields the handler's 400 "narrow your filters" (on a DB
    // with >1000 matching shipments) or 200 with the rows (on a small DB) — never
    // a 500. NOTE: passes against QA only once the on-prem server is redeployed
    // with the shipments-repo cap.
    const res = await qaApiFetch(`${LH}/shipments`)
    expect(
      [200, 400],
      `unexpected status ${res.status}: ${await res.text().catch(() => '')}`,
    ).toContain(res.status)
  })

  // Since Phase 3 of the longhaul strangler-fig migration, GET /trips (LIST) is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/trips-list.ts):
  // the cloud Hono Lambda queries Dolios MSSQL through the mssql-executor
  // Lambda instead of proxying to the on-prem server. The on-prem repo made
  // TWO MSSQL round trips (trips list + a separate TripNotes fetch); the
  // cloud handler collapses the notes fetch into one query. The response shape
  // must stay identical to the on-prem handler — `{ data: [...], meta }` with
  // each trip carrying a `notes` array.
  test('GET /trips returns a trips list (cloud-direct)', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/trips`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = body.data ?? body
    expect(Array.isArray(rows), 'cloud-direct /trips returns { data: [...] }').toBe(true)
    if (body.meta) expect(typeof body.meta.count).toBe('number')
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('id')
      expect(Array.isArray(rows[0].notes), 'each trip carries a notes array').toBe(true)
    }
  })

  test('GET /trips with a filters query param returns a (possibly filtered) list', async ({
    qaApiFetch,
  }) => {
    const filters = JSON.stringify({ TripStatus_id: 1 })
    const res = await qaApiFetch(`${LH}/trips?filters=${encodeURIComponent(filters)}`)
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).data ?? [])).toBe(true)
  })

  test('GET /trips/:id returns 404 for a non-existent trip', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/trips/999999999`)
    expect(res.status).toBe(404)
  })

  // Since Phase 3 of the longhaul strangler-fig migration, GET /trips/:id is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/trip-detail.ts):
  // the cloud Hono Lambda queries Dolios MSSQL through the mssql-executor
  // Lambda in 1-2 batched round trips instead of proxying to the on-prem
  // server (which fanned the trip+shipment load out into ~8 queries). The
  // response shape must stay identical to the on-prem handler — `{ data }`
  // with embedded `activities`, `notes`, and `shipments`.
  test('GET /trips/:id returns a trip detail in { data } shape (cloud-direct)', async ({
    qaApiFetch,
  }) => {
    const list = await (await qaApiFetch(`${LH}/trips`)).json()
    const trips: Array<{ id: number }> = list.data ?? list
    test.skip(!Array.isArray(trips) || trips.length === 0, 'no trips in the QA DB')
    const tripId = trips[0]!.id

    const res = await qaApiFetch(`${LH}/trips/${tripId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const trip = body.data ?? body
    expect(trip, 'cloud-direct /trips/:id returns { data: <trip> }').toBeDefined()
    expect(Number(trip.id)).toBe(tripId)
    expect(Array.isArray(trip.activities), 'trip carries an activities array').toBe(true)
    expect(Array.isArray(trip.notes), 'trip carries a notes array').toBe(true)
    expect(Array.isArray(trip.shipments), 'trip carries a shipments array').toBe(true)
  })

  test('GET /trip-statuses returns statuses', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/trip-statuses`)
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).data ?? [])).toBe(true)
  })

  test('GET /drivers returns a drivers list', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/drivers`)
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).data ?? [])).toBe(true)
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /driver-planning is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/driver-planning.ts):
  // the cloud Hono Lambda queries Dolios MSSQL through the mssql-executor Lambda
  // in ONE OUTER APPLY query (collapsing the on-prem repo's ~5 round trips). The
  // response shape must stay identical to the on-prem handler — `{ data, meta }`.
  test('GET /driver-planning returns driver availability rows', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/driver-planning`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = Array.isArray(body) ? body : body.data
    expect(Array.isArray(rows), 'cloud-direct /driver-planning returns { data }').toBe(true)
    if (body.meta) expect(typeof body.meta.count).toBe('number')
    // Each row carries the estimated/confirmed availability shape the UI expects.
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0]
      expect(row).toHaveProperty('driverId')
      expect(row).toHaveProperty('estimatedAvailableDate')
      expect(row).toHaveProperty('confirmedAvailableDate')
    }
  })

  test('GET /filter-options returns filter options', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/filter-options`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data ?? body).toBeDefined()
  })

  // Since Phase 3 of the longhaul strangler-fig migration, /shipment-filters is
  // served cloud-direct (apps/api/src/handlers/longhaul-cloud/shipment-filters.ts):
  // the cloud Hono Lambda resolves the caller's legacy longhaul identity and
  // queries Dolios MSSQL through the mssql-executor Lambda instead of proxying
  // to the on-prem server. The response shape must stay identical — `{ data: [] }`.
  test('GET /shipment-filters returns the saved filters for the user', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/shipment-filters`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(
      Array.isArray(body.data ?? []),
      'cloud-direct /shipment-filters returns { data: [] }',
    ).toBe(true)
  })

  test('POST /trips with no shipments is rejected (403)', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/trips`, {
      method: 'POST',
      body: JSON.stringify({ trip_title: 'E2E QA — should be rejected', shipments: [] }),
    })
    expect(res.status).toBe(403)
  })

  test('PATCH /trips/:id/status returns 404 for a non-existent trip', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/trips/999999999/status`, {
      method: 'PATCH',
      body: JSON.stringify({ statusId: 2 }),
    })
    expect(res.status).toBe(404)
  })

  // -- write round-trips ---------------------------------------------------

  test('PATCH /driver-planning/:driverId round-trips confirmed availability @qa-mutating', async ({
    qaApiFetch,
  }) => {
    const list = await (await qaApiFetch(`${LH}/driver-planning`)).json()
    const rows: Array<{ driverId: number }> = list.data ?? list
    test.skip(!Array.isArray(rows) || rows.length === 0, 'no drivers in the QA DB')
    const driverId = rows[0]!.driverId

    const notes = `e2e-qa-${Date.now()}`
    const confirmedLocation = 'E2E City, EA'
    const confirmedDate = new Date().toISOString().slice(0, 10)

    const patch = await qaApiFetch(`${LH}/driver-planning/${driverId}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmedDate, confirmedLocation, notes }),
    })
    expect(patch.status, await patch.text().catch(() => '')).toBeLessThan(300)

    const after = await (await qaApiFetch(`${LH}/driver-planning`)).json()
    const afterRows: Array<{ driverId: number; confirmedNotes: string | null }> =
      after.data ?? after
    const updated = afterRows.find((r) => r.driverId === driverId)
    expect(updated?.confirmedNotes).toBe(notes)
  })

  test('POST /trips → GET /trips/:id → POST /trips/:id/cancel @qa-mutating', async ({
    qaApiFetch,
  }) => {
    const [meRes, driversRes, shipmentsRes] = await Promise.all([
      qaApiFetch(`${LH}/users/me`).then((r) => r.json()),
      qaApiFetch(`${LH}/drivers`).then((r) => r.json()),
      qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(
          JSON.stringify(planningWindowQuery({ assigned: [{ label: 'No', value: 'No' }] })),
        )}`,
      ).then((r) => r.json()),
    ])
    const me = meRes.data
    const drivers: Array<Record<string, unknown>> = driversRes.data ?? driversRes
    const shipments: Array<Record<string, unknown> & { order_num: number }> =
      shipmentsRes.data ?? shipmentsRes
    expect(me?.code, 'legacy user resolved').toBeTruthy()
    test.skip(!Array.isArray(drivers) || drivers.length === 0, 'no drivers available in the QA DB')
    test.skip(
      !Array.isArray(shipments) || shipments.length === 0,
      'no unassigned shipments in the QA DB',
    )
    const shipment = shipments[0]!
    const driver = drivers[0]!

    const create = await qaApiFetch(`${LH}/trips`, {
      method: 'POST',
      body: JSON.stringify({
        trip_title: `e2e-qa-${Date.now()}`,
        driver,
        dispatcher: me,
        created_by_id: me.code,
        status: { id: 1, status_id: 1, status: 'Pending' },
        shipments: [shipment],
      }),
    })
    const createText = await create.text()
    expect(create.status, createText).toBe(201)
    const createBody = createText ? JSON.parse(createText) : {}
    const createdRaw = createBody?.data ?? createBody
    const tripId = createdRaw?.id ?? createdRaw?.trip?.id
    expect(tripId, 'POST /trips returned an id').toBeTruthy()

    const fetched = await qaApiFetch(`${LH}/trips/${tripId}`)
    expect(fetched.status).toBe(200)
    const fetchedBody = await fetched.json()
    const trip = fetchedBody?.data ?? fetchedBody
    // Trip is in a cancellable state (status < 4).
    expect(Number(trip?.TripStatus_id ?? trip?.status_id)).toBeLessThan(4)

    const cancel = await qaApiFetch(`${LH}/trips/${tripId}/cancel`, { method: 'POST' })
    expect(cancel.status, await cancel.text().catch(() => '')).toBeLessThan(300)
  })

  test('PATCH /shipments/:id/shadow round-trips the shadow fields @qa-mutating', async ({
    qaApiFetch,
  }) => {
    // Pick any shipment in the planning window — shadow lives in its own table
    // (ps in shipments.repository.ts), independent of trip assignment. The
    // /shipments response carries flat `lng_dis_comments` directly; the nested
    // `pegasus_shadow` object is built by the client-side reshape only
    // (reshape-shipment.ts), so the raw API path returns null for it.
    const sList = await (
      await qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(JSON.stringify(planningWindowQuery()))}`,
      )
    ).json()
    const shipments: Array<{ order_num: number; lng_dis_comments?: string | null }> =
      sList.data ?? sList
    test.skip(
      !Array.isArray(shipments) || shipments.length === 0,
      'no shipments in the QA DB under the default planning window',
    )
    const target = shipments[0]!
    const orderNum = target.order_num
    const original = target.lng_dis_comments ?? null

    const marker = `e2e-qa-${Date.now()}`
    // The ShadowBody zod schema requires order_num in the JSON body in addition
    // to the URL :id param (apps/api/src/handlers/longhaul/shipments.ts:39).
    const patch = await qaApiFetch(`${LH}/shipments/${orderNum}/shadow`, {
      method: 'PATCH',
      body: JSON.stringify({ order_num: orderNum, lng_dis_comments: marker }),
    })
    expect(patch.status, await patch.text().catch(() => '')).toBeLessThan(300)

    // Read-back: query by the same planning window and find the updated row
    // (searchTerm returns a different, narrower projection that doesn't carry
    // shadow columns — pre-reshape, the raw shipment row exposes them).
    const after = await (
      await qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(JSON.stringify(planningWindowQuery()))}`,
      )
    ).json()
    const reread: Array<{ order_num: number; lng_dis_comments?: string | null }> =
      after.data ?? after
    const updated = reread.find((s) => s.order_num === orderNum)
    expect(updated?.lng_dis_comments ?? '').toContain(marker)

    // Revert to keep snapshots tidy.
    await qaApiFetch(`${LH}/shipments/${orderNum}/shadow`, {
      method: 'PATCH',
      body: JSON.stringify({ order_num: orderNum, lng_dis_comments: original }),
    })
  })

  test('POST /trips/:id/notes → PATCH /notes/:id round-trips the note body @qa-mutating', async ({
    qaApiFetch,
  }) => {
    // Find any existing trip — we only need a parent for the note, not a
    // specific status. Don't create one (less DB churn).
    const tripsList = await (await qaApiFetch(`${LH}/trips`)).json()
    const trips: Array<{ id: number }> = tripsList.data ?? tripsList
    test.skip(
      !Array.isArray(trips) || trips.length === 0,
      'no trips in the QA DB to attach a note to',
    )
    const tripId = trips[0]!.id

    const marker = `e2e-qa-note-${Date.now()}`
    const create = await qaApiFetch(`${LH}/trips/${tripId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ note: marker, type: 'DISPATCH' }),
    })
    expect(create.status, await create.text().catch(() => '')).toBe(201)

    // Find the note by its marker — the POST returns just {success:true}.
    const after = await (await qaApiFetch(`${LH}/trips/${tripId}`)).json()
    const trip = after.data ?? after
    const created = (trip?.notes as Array<{ id: number; note: string }> | undefined)?.find(
      (n) => n.note === marker,
    )
    expect(created, 'POSTed note appears in the trip response').toBeDefined()

    const updatedMarker = `${marker}-updated`
    const patch = await qaApiFetch(`${LH}/notes/${created!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ note: updatedMarker, tripId }),
    })
    expect(patch.status, await patch.text().catch(() => '')).toBeLessThan(300)

    const reread = await (await qaApiFetch(`${LH}/trips/${tripId}`)).json()
    const reTrip = reread.data ?? reread
    const reNote = (reTrip?.notes as Array<{ id: number; note: string }> | undefined)?.find(
      (n) => n.id === created!.id,
    )
    expect(reNote?.note).toBe(updatedMarker)
  })

  test('POST /activities then GET /activities reflects it @qa-mutating', async ({ qaApiFetch }) => {
    const sList = await (
      await qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(
          JSON.stringify(planningWindowQuery({ assigned: [{ label: 'No', value: 'No' }] })),
        )}`,
      )
    ).json()
    const shipments: Array<Record<string, unknown> & { order_num: number }> = sList.data ?? sList
    test.skip(
      !Array.isArray(shipments) || shipments.length === 0,
      'no unassigned shipments in the QA DB',
    )
    const [me, drivers] = await Promise.all([
      qaApiFetch(`${LH}/users/me`)
        .then((r) => r.json())
        .then((j) => j.data),
      qaApiFetch(`${LH}/drivers`)
        .then((r) => r.json())
        .then((j) => j.data ?? j),
    ])
    test.skip(!Array.isArray(drivers) || drivers.length === 0, 'no drivers available in the QA DB')
    const shipment = shipments[0]!
    const driver = drivers[0]

    const create = await qaApiFetch(`${LH}/trips`, {
      method: 'POST',
      body: JSON.stringify({
        trip_title: `e2e-qa-activities-${Date.now()}`,
        driver,
        dispatcher: me,
        created_by_id: me.code,
        status: { id: 1, status_id: 1, status: 'Pending' },
        shipments: [shipment],
      }),
    })
    const createText = await create.text()
    expect(create.status, createText).toBe(201)
    const createBody = createText ? JSON.parse(createText) : {}
    const created = createBody?.data ?? createBody
    const tripId = created?.id ?? created?.trip?.id
    expect(tripId).toBeTruthy()

    try {
      // The trip create flow already adds the generated PACK/LOAD/RDEL
      // activities for the shipment via buildShipmentActivities. Confirm GET
      // sees them.
      const fetched = await qaApiFetch(`${LH}/trips/${tripId}`)
      const fetchedBody = await fetched.json()
      const trip = fetchedBody?.data ?? fetchedBody
      const activities = (trip?.activities as unknown[]) ?? []
      expect(activities.length, 'auto-generated activities present').toBeGreaterThan(0)
    } finally {
      // Cleanup: cancel the trip so the shipment is returned to unassigned.
      await qaApiFetch(`${LH}/trips/${tripId}/cancel`, { method: 'POST' })
    }
  })
})
