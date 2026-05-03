// ---------------------------------------------------------------------------
// Cedar/AVP authorization — wasm backend table tests.
//
// Exercises the offline path against the same .cedar files that production
// pushes into AVP. Required invariants per the plan:
//   (a) tenant_admin allowed every action in ALL_ACTIONS
//   (b) tenant_user allowed reads, denied writes
//   (c) personas (dispatcher, sales, accountant, auditor) match their files
//   (d) empty-roles principal denied everything
//   (e) listAllowedPermissions returns the full catalog for tenant_admin
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

  it('tenant_user is allowed every read action (invariant b — allow side)', async () => {
    const p = principal(['tenant_user'])
    const reads: ActionDef[] = [
      Actions.ReadQuote,
      Actions.ReadMove,
      Actions.ReadInvoice,
      Actions.ReadCustomer,
    ]
    for (const a of reads) {
      expect(await isAllowed(p, a), `tenant_user should be allowed ${a.id}`).toBe(true)
    }
  })

  it('tenant_user is denied every write action (invariant b — deny side)', async () => {
    const p = principal(['tenant_user'])
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
      Actions.UpdateSettings,
      Actions.CreateApiClient,
      Actions.RotateApiClient,
      Actions.RevokeApiClient,
    ]
    for (const a of writes) {
      expect(await isAllowed(p, a), `tenant_user should be denied ${a.id}`).toBe(false)
    }
  })

  it('dispatcher matches its persona policy (invariant c)', async () => {
    const ids = new Set(await allowedActionIds(principal(['dispatcher'])))
    expect(ids).toEqual(
      new Set([
        Actions.ReadMove.id,
        Actions.CreateMove.id,
        Actions.UpdateMove.id,
        Actions.ReadCustomer.id,
        Actions.UpdateCustomer.id,
        Actions.ReadQuote.id,
      ]),
    )
  })

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
        Actions.ReadMove.id,
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
        Actions.ReadMove.id,
        Actions.ReadCustomer.id,
      ]),
    )
  })

  it('auditor matches its persona policy (invariant c)', async () => {
    const ids = new Set(await allowedActionIds(principal(['auditor'])))
    expect(ids).toEqual(
      new Set([
        Actions.ReadQuote.id,
        Actions.ReadMove.id,
        Actions.ReadInvoice.id,
        Actions.ReadCustomer.id,
      ]),
    )
  })

  it('empty-roles principal is denied everything (invariant d)', async () => {
    const allowed = await allowedActionIds(principal([]))
    expect(allowed.length).toBe(0)
  })

  it('decision source is "offline" when no policyStoreId is provided', async () => {
    const d = await authorize({ principal: principal(['tenant_admin']), action: Actions.ReadMove })
    expect(d.source).toBe('offline')
  })
})

describe('listAllowedPermissions — offline', () => {
  it('returns the full permission catalog for tenant_admin (invariant e)', async () => {
    const perms = await listAllowedPermissions(principal(['tenant_admin']), undefined, undefined)
    expect(new Set(perms)).toEqual(new Set(ALL_ACTIONS.map((a) => a.permission)))
  })

  it('returns only read permissions for tenant_user', async () => {
    const perms = await listAllowedPermissions(principal(['tenant_user']), undefined, undefined)
    expect(new Set(perms)).toEqual(
      new Set([
        Actions.ReadQuote.permission,
        Actions.ReadMove.permission,
        Actions.ReadInvoice.permission,
        Actions.ReadCustomer.permission,
      ]),
    )
  })

  it('returns empty array for an empty-roles principal', async () => {
    const perms = await listAllowedPermissions(principal([]), undefined, undefined)
    expect(perms).toEqual([])
  })
})
