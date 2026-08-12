// ---------------------------------------------------------------------------
// Cedar/AVP authorization — wasm backend table tests.
//
// Exercises the offline path against the same .cedar files that production
// pushes into AVP. Required invariants per the plan:
//   (a) tenant_admin allowed every action in ALL_ACTIONS
//   (b) viewer allowed reads, denied writes
//   (c) personas with full policies (sales, accountant) match their files
//   (d) empty-roles principal denied everything
//   (e) listAllowedPermissions returns the full catalog for tenant_admin
//   (f) stub personas (legacy-derived placeholders without permit clauses)
//       grant zero permissions until their policy is authored
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { ALL_ACTIONS, Actions, type ActionDef } from '../authz/actions'
import { authorize, listAllowedPermissions, _clearAuthzCache } from './authz'
import type { Principal } from './authz.types'

function principal(roleNames: string[], sub = 'sub-test'): Principal {
  return { sub, tenantId: 'tenant-test', roleNames }
}

async function isAllowed(p: Principal, action: ActionDef): Promise<boolean> {
  const d = await authorize({ principal: p, action })
  return d.allowed
}

async function allowedActionIds(p: Principal): Promise<string[]> {
  const out: string[] = []
  for (const a of ALL_ACTIONS) {
    if (await isAllowed(p, a)) out.push(a.id)
  }
  return out
}

beforeEach(() => {
  _clearAuthzCache()
  // Force the offline path even if AVP env is leaked into the test runner.
  process.env['AUTHZ_OFFLINE'] = 'true'
})

describe('authorize — offline (cedar-wasm)', () => {
  it('tenant_admin is allowed every action in ALL_ACTIONS (invariant a)', async () => {
    const allowed = await allowedActionIds(principal(['tenant_admin']))
    expect(allowed.length).toBe(ALL_ACTIONS.length)
  })

  it('viewer is allowed every read action (invariant b — allow side)', async () => {
    const p = principal(['viewer'])
    const reads: ActionDef[] = [
      Actions.ReadQuote,
      Actions.ReadMove,
      Actions.ReadInvoice,
      Actions.ReadCustomer,
    ]
    for (const a of reads) {
      expect(await isAllowed(p, a), `viewer should be allowed ${a.id}`).toBe(true)
    }
  })

  it('viewer is denied every write action (invariant b — deny side)', async () => {
    const p = principal(['viewer'])
    const writes: ActionDef[] = [
      Actions.CreateQuote,
      Actions.UpdateQuote,
      Actions.DeleteQuote,
      Actions.CreateMove,
      Actions.UpdateMove,
      Actions.DeleteMove,
      Actions.CreateInvoice,
      Actions.UpdateInvoice,
      Actions.DeleteInvoice,
      Actions.CreateCustomer,
      Actions.UpdateCustomer,
      Actions.DeleteCustomer,
      Actions.InviteUser,
      Actions.UpdateUser,
      Actions.DeactivateUser,
      Actions.ReactivateUser,
      Actions.UpdateSettings,
      Actions.CreateApiClient,
      Actions.RotateApiClient,
      Actions.RevokeApiClient,
    ]
    for (const a of writes) {
      expect(await isAllowed(p, a), `viewer should be denied ${a.id}`).toBe(false)
    }
  })

  // Every authenticated principal — regardless of role — may read and upload
  // documents (50-documents-shared.cedar, unconstrained permit). This baseline
  // therefore shows up in every persona's allowed set below.
  const DOC_BASELINE = [Actions.ReadDocument.id, Actions.UploadDocument.id]

  it('sales matches its persona policy (invariant c)', async () => {
    const ids = new Set(await allowedActionIds(principal(['sales'])))
    expect(ids).toEqual(
      new Set([
        Actions.ReadQuote.id,
        Actions.CreateQuote.id,
        Actions.UpdateQuote.id,
        Actions.ReadCustomer.id,
        Actions.CreateCustomer.id,
        Actions.UpdateCustomer.id,
        Actions.ListMoves.id,
        Actions.ReadMove.id,
        // Reporting routes are open to every human persona; the datasets a
        // sales user actually sees are still gated by the actions above.
        Actions.ReadReportingDataset.id,
        ...DOC_BASELINE,
      ]),
    )
  })

  it('accountant matches its persona policy (invariant c)', async () => {
    const ids = new Set(await allowedActionIds(principal(['accountant'])))
    expect(ids).toEqual(
      new Set([
        Actions.ReadInvoice.id,
        Actions.CreateInvoice.id,
        Actions.UpdateInvoice.id,
        Actions.DeleteInvoice.id,
        Actions.ReadQuote.id,
        Actions.ListMoves.id,
        Actions.ReadMove.id,
        Actions.ReadCustomer.id,
        // billing/accounting role: may also delete/archive documents.
        Actions.DeleteDocument.id,
        Actions.ReadReportingDataset.id,
        ...DOC_BASELINE,
      ]),
    )
  })

  it('a pure placeholder persona grants only the shared document baseline (invariant f)', async () => {
    // The placeholder Cedar files for the legacy-derived personas
    // (operations_admin, coordinator, senior_management, …) carry no permit
    // clause of their own, so assigning such a role grants nothing BEYOND the
    // universal document read/upload baseline — a stray persona permit would
    // show up here as an extra id.
    const ids = new Set(await allowedActionIds(principal(['operations_admin'])))
    expect(ids).toEqual(new Set(DOC_BASELINE))
  })

  it('billing_manager may delete documents (billing/accounting role)', async () => {
    const ids = new Set(await allowedActionIds(principal(['billing_manager'])))
    expect(ids).toEqual(
      new Set([Actions.DeleteDocument.id, Actions.ReadReportingDataset.id, ...DOC_BASELINE]),
    )
  })

  it('empty-roles principal gets only the shared document baseline (invariant d)', async () => {
    // Fail-closed for everything role-gated; the only cross-role grant is the
    // universal document read/upload baseline (50-documents-shared.cedar).
    const ids = new Set(await allowedActionIds(principal([])))
    expect(ids).toEqual(new Set(DOC_BASELINE))
  })

  it('decision source is "offline" when no policyStoreId is provided', async () => {
    const d = await authorize({ principal: principal(['tenant_admin']), action: Actions.ReadMove })
    expect(d.source).toBe('offline')
  })
})

describe('authorize — driver crew-scoped ABAC', () => {
  const CREW = 'crew-member-1'
  const driver = (): Principal => ({ ...principal(['driver']), crewMemberId: CREW })

  it('allows ListMoves — the coarse feature gate', async () => {
    expect(await isAllowed(driver(), Actions.ListMoves)).toBe(true)
  })

  it('allows ReadMove when the move is assigned to the driver crew member', async () => {
    const d = await authorize({
      principal: driver(),
      action: Actions.ReadMove,
      resource: { type: 'Move', id: 'move-1', attrs: { assignedCrewMembers: [CREW, 'crew-x'] } },
    })
    expect(d.allowed).toBe(true)
  })

  it('denies ReadMove when the move is not assigned to the driver crew member', async () => {
    const d = await authorize({
      principal: driver(),
      action: Actions.ReadMove,
      resource: { type: 'Move', id: 'move-2', attrs: { assignedCrewMembers: ['crew-x'] } },
    })
    expect(d.allowed).toBe(false)
  })

  it('denies ReadMove when the move has no assigned crew (empty attrs)', async () => {
    const d = await authorize({
      principal: driver(),
      action: Actions.ReadMove,
      resource: { type: 'Move', id: 'move-3', attrs: {} },
    })
    expect(d.allowed).toBe(false)
  })

  it('denies ReadMove when the driver principal has no crewMemberId', async () => {
    const d = await authorize({
      principal: principal(['driver']),
      action: Actions.ReadMove,
      resource: { type: 'Move', id: 'move-4', attrs: { assignedCrewMembers: [CREW] } },
    })
    expect(d.allowed).toBe(false)
  })

  it('denies move writes — a driver holds neither CreateMove nor UpdateMove', async () => {
    expect(await isAllowed(driver(), Actions.CreateMove)).toBe(false)
    expect(await isAllowed(driver(), Actions.UpdateMove)).toBe(false)
  })

  it('denies ReadReportingDataset — a driver must not read tenant-wide aggregates', async () => {
    // driver's ListMoves is a COARSE feature gate; the real scoping is a
    // handler DB filter (handlers/moves.ts limits a driver to their own crew
    // assignments). Reporting datasets authorize on the Cedar action alone, so
    // granting report:read here would hand a driver tenant-wide move counts via
    // moves-by-status and the longhaul views. Keep this denied unless a dataset
    // ever carries per-principal row scoping of its own.
    expect(await isAllowed(driver(), Actions.ReadReportingDataset)).toBe(false)
  })

  it('still allows tenant_admin to read a move regardless of crew assignment', async () => {
    const d = await authorize({
      principal: principal(['tenant_admin']),
      action: Actions.ReadMove,
      resource: { type: 'Move', id: 'move-5', attrs: { assignedCrewMembers: ['crew-x'] } },
    })
    expect(d.allowed).toBe(true)
  })
})

describe('listAllowedPermissions — offline', () => {
  it('returns the full permission catalog for tenant_admin (invariant e)', async () => {
    const perms = await listAllowedPermissions(principal(['tenant_admin']), undefined, undefined)
    expect(new Set(perms)).toEqual(new Set(ALL_ACTIONS.map((a) => a.permission)))
  })

  it('returns the viewer read set plus the shared document baseline', async () => {
    const perms = await listAllowedPermissions(principal(['viewer']), undefined, undefined)
    expect(new Set(perms)).toEqual(
      new Set([
        Actions.ReadQuote.permission,
        Actions.ListMoves.permission,
        Actions.ReadMove.permission,
        Actions.ReadInvoice.permission,
        Actions.ReadCustomer.permission,
        Actions.ReadWorkflow.permission,
        Actions.ReadIntegrationConfig.permission,
        Actions.ReadIntegrationProjection.permission,
        Actions.ReadFeedbackForms.permission,
        Actions.RateShipment.permission,
        Actions.ReadTariff.permission,
        Actions.ReadReportingDataset.permission,
        // Universal document baseline (upload is a write, but granted to all).
        Actions.ReadDocument.permission,
        Actions.UploadDocument.permission,
      ]),
    )
  })

  it('returns only the shared document baseline for an empty-roles principal', async () => {
    const perms = await listAllowedPermissions(principal([]), undefined, undefined)
    expect(new Set(perms)).toEqual(
      new Set([Actions.ReadDocument.permission, Actions.UploadDocument.permission]),
    )
  })
})

describe('authorize — cache invalidation on roleNames change', () => {
  // Regression: the cache used to key on (sub, action, ...) only. Reassigning
  // roles to the same sub then returned the previous decision until the 60s
  // TTL expired — silently masking demotions for up to a minute. The cache
  // now includes a sorted roleNames hash so role flips invalidate immediately.
  it('serves a fresh decision when the same sub flips from no-roles to tenant_admin', async () => {
    const sub = 'sub-cache-flip'
    const noRoles = principal([], sub)
    const adminRoles = principal(['tenant_admin'], sub)

    const denied = await authorize({ principal: noRoles, action: Actions.CreateMove })
    expect(denied.allowed).toBe(false)

    const allowed = await authorize({ principal: adminRoles, action: Actions.CreateMove })
    expect(allowed.allowed).toBe(true)
  })

  it('serves a fresh decision when the same sub flips from tenant_admin back to no-roles', async () => {
    const sub = 'sub-cache-demote'
    const adminRoles = principal(['tenant_admin'], sub)
    const noRoles = principal([], sub)

    const allowed = await authorize({ principal: adminRoles, action: Actions.CreateMove })
    expect(allowed.allowed).toBe(true)

    // The demotion. With the old key the cache would have returned `allowed`
    // for up to 60s — the bug this regression test pins.
    const denied = await authorize({ principal: noRoles, action: Actions.CreateMove })
    expect(denied.allowed).toBe(false)
  })

  it('treats roleNames as a set — order does not change the cache key', async () => {
    const sub = 'sub-role-order'
    // Same set, different order → same logical principal → same cache slot.
    const a = principal(['local_dispatch', 'sales'], sub)
    const b = principal(['sales', 'local_dispatch'], sub)

    const first = await authorize({ principal: a, action: Actions.ReadMove })
    const second = await authorize({ principal: b, action: Actions.ReadMove })
    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
  })
})
