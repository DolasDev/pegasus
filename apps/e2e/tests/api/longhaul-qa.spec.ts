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

  test('GET /shipments unfiltered — known robustness gap on large DBs', async ({ qaApiFetch }) => {
    // On a large planning DB the longhaul shipments query builds a SQL statement
    // with hundreds of thousands of bind parameters (observed @p193800+ in the
    // on-prem log → "Maximum call stack size exceeded" in tedious), well past
    // SQL Server's 2100-parameter limit. The endpoint should clamp/chunk before
    // building the query rather than 500. Tracked as a Phase-A/longhaul finding;
    // unmark when the repo is fixed.
    test.fixme(
      true,
      'longhaul shipments repo: parameter explosion on unfiltered scan — see findings',
    )
    const res = await qaApiFetch(`${LH}/shipments`)
    expect(res.status).toBe(200)
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

  test('POST /trips → GET /trips/:id → POST /trips/:id/cancel @qa-mutating', async () => {
    // The exact create-trip request body (shipment refs, activity shape) needs
    // confirmation from the Phase A pass / a sample payload. Stub until then.
    test.fixme(true, 'fill in the create-trip body once a sample payload is captured (see QA.md)')
  })

  test('PATCH /shipments/:id/shadow round-trips the shadow fields @qa-mutating', async () => {
    test.fixme(true, 'confirm the shadow PATCH body shape from Phase A')
  })

  test('POST /activities then GET /activities reflects it @qa-mutating', async () => {
    test.fixme(true, 'confirm the activity create body shape from Phase A')
  })
})
