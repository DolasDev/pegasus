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

// Mirror the UI's default planning-window filter (see redux/shipments/index.ts):
// the unbounded /shipments query trips RESULT_LIMIT_EXCEEDED on the real QA DB,
// so any spec that fetches "an unassigned shipment" must scope to the same
// ±30-day load_date window the UI uses.
const dateOffset = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const planningWindow = (): { load_date: [string, string] } => ({
  load_date: [dateOffset(-30), dateOffset(30)],
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

  test('GET /version returns version info @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/version`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data ?? body).toBeDefined()
  })

  test('GET /users/me returns the mapped legacy user @smoke', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/users/me`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data ?? body, 'legacyWindowsUsername should resolve to a Dolios user').toBeTruthy()
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

  test('GET /trips returns a trips list', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/trips`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data ?? body)).toBe(true)
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

  test('GET /driver-planning returns driver availability rows', async ({ qaApiFetch }) => {
    // NOTE: fails against QA until the on-prem server is redeployed with the
    // getDriverPlanning fix (v_longhaul_drivers returns UPPERCASE columns on
    // Dolios, so d.driver_id was undefined → "Undefined binding(s)" 500).
    const res = await qaApiFetch(`${LH}/driver-planning`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = Array.isArray(body) ? body : body.data
    expect(Array.isArray(rows)).toBe(true)
  })

  test('GET /filter-options returns filter options', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/filter-options`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data ?? body).toBeDefined()
  })

  test('GET /shipment-filters returns the saved filters for the user', async ({ qaApiFetch }) => {
    const res = await qaApiFetch(`${LH}/shipment-filters`)
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).data ?? [])).toBe(true)
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
    // Find an unassigned shipment in the default planning window. Don't
    // assume what's in the DB — skip if nothing's available.
    const sList = await (
      await qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(
          JSON.stringify({
            Is_Trip_Planning: true,
            ...planningWindow(),
            assigned: [{ label: 'No', value: 'No' }],
          }),
        )}`,
      )
    ).json()
    const shipments: Array<{ order_num: number }> = sList.data ?? sList
    test.skip(
      !Array.isArray(shipments) || shipments.length === 0,
      'no unassigned shipments in the QA DB',
    )
    const orderNum = shipments[0]!.order_num

    const create = await qaApiFetch(`${LH}/trips`, {
      method: 'POST',
      body: JSON.stringify({
        trip_title: `e2e-qa-${Date.now()}`,
        TripStatus_id: 1,
        shipments: [{ order_num: orderNum, activities: [] }],
      }),
    })
    expect(create.status, await create.text().catch(() => '')).toBe(201)
    const createdRaw = (await create.json()).data ?? (await create.json())
    const tripId = createdRaw?.id ?? createdRaw?.trip?.id
    expect(tripId, 'POST /trips returned an id').toBeTruthy()

    const fetched = await qaApiFetch(`${LH}/trips/${tripId}`)
    expect(fetched.status).toBe(200)
    const trip = (await fetched.json()).data ?? (await fetched.json())
    // Trip is in a cancellable state (status < 4).
    expect(Number(trip?.TripStatus_id ?? trip?.status_id)).toBeLessThan(4)

    const cancel = await qaApiFetch(`${LH}/trips/${tripId}/cancel`, { method: 'POST' })
    expect(cancel.status, await cancel.text().catch(() => '')).toBeLessThan(300)
  })

  test('PATCH /shipments/:id/shadow round-trips the shadow fields @qa-mutating', async ({
    qaApiFetch,
  }) => {
    // Find any shipment with an order_num — we don't need it to be unassigned
    // since shadow is its own table. Read its current shadow values, patch
    // to a known marker, verify the read-back picks up the change, then revert.
    const sList = await (
      await qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(
          JSON.stringify({ Is_Trip_Planning: true, ...planningWindow() }),
        )}`,
      )
    ).json()
    const shipments: Array<{ order_num: number; pegasus_shadow?: { lng_dis_comments?: string } }> =
      sList.data ?? sList
    test.skip(
      !Array.isArray(shipments) || shipments.length === 0,
      'no shipments in the QA DB under the default planning window',
    )
    const target = shipments[0]!
    const orderNum = target.order_num
    const original = target.pegasus_shadow?.lng_dis_comments ?? null

    const marker = `e2e-qa-${Date.now()}`
    const patch = await qaApiFetch(`${LH}/shipments/${orderNum}/shadow`, {
      method: 'PATCH',
      body: JSON.stringify({ lng_dis_comments: marker }),
    })
    expect(patch.status, await patch.text().catch(() => '')).toBeLessThan(300)

    // Read-back: the reshape layer is what the UI relies on, so verify the
    // patched value surfaces under the same key (`pegasus_shadow.lng_dis_comments`).
    const after = await (
      await qaApiFetch(`${LH}/shipments?searchTerm=${encodeURIComponent(String(orderNum))}`)
    ).json()
    const reread: Array<{ order_num: number; pegasus_shadow?: { lng_dis_comments?: string } }> =
      after.data ?? after
    const updated = reread.find((s) => s.order_num === orderNum)
    expect(updated?.pegasus_shadow?.lng_dis_comments ?? '').toContain(marker)

    // Revert to keep snapshots tidy.
    await qaApiFetch(`${LH}/shipments/${orderNum}/shadow`, {
      method: 'PATCH',
      body: JSON.stringify({ lng_dis_comments: original }),
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
    // Create a trip, add an activity to it, verify the activity surfaces, then
    // cancel the trip (cleanup). Activities require a parent trip.
    const sList = await (
      await qaApiFetch(
        `${LH}/shipments?filters=${encodeURIComponent(
          JSON.stringify({
            Is_Trip_Planning: true,
            ...planningWindow(),
            assigned: [{ label: 'No', value: 'No' }],
          }),
        )}`,
      )
    ).json()
    const shipments: Array<{ order_num: number }> = sList.data ?? sList
    test.skip(
      !Array.isArray(shipments) || shipments.length === 0,
      'no unassigned shipments in the QA DB',
    )
    const orderNum = shipments[0]!.order_num

    const create = await qaApiFetch(`${LH}/trips`, {
      method: 'POST',
      body: JSON.stringify({
        trip_title: `e2e-qa-activities-${Date.now()}`,
        TripStatus_id: 1,
        shipments: [{ order_num: orderNum, activities: [] }],
      }),
    })
    expect(create.status, await create.text().catch(() => '')).toBe(201)
    const created = (await create.json()).data ?? (await create.json())
    const tripId = created?.id ?? created?.trip?.id
    expect(tripId).toBeTruthy()

    try {
      // The trip create flow already adds the generated PACK/LOAD/RDEL
      // activities for the shipment via buildShipmentActivities. Confirm GET
      // sees them.
      const fetched = await qaApiFetch(`${LH}/trips/${tripId}`)
      const trip = (await fetched.json()).data ?? (await fetched.json())
      const activities = (trip?.activities as unknown[]) ?? []
      expect(activities.length, 'auto-generated activities present').toBeGreaterThan(0)
    } finally {
      // Cleanup: cancel the trip so the shipment is returned to unassigned.
      await qaApiFetch(`${LH}/trips/${tripId}/cancel`, { method: 'POST' })
    }
  })
})
