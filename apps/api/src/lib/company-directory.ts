// ---------------------------------------------------------------------------
// A company's pegII employee directory, read for an admin action — and the
// membership sync that consumes it (cloud identity I3).
//
// Shared by:
//   POST /settings/companies/:id/membership-sync — link users to employees
//   GET  /settings/companies/:id/directory       — "Add from pegII" picker
//   POST /users/import                            — create users from it
//
// The read goes to the company's site as the calling principal, routed by the
// company's `cid`. Two refusals happen before any pegII call:
//   - a company this tenant can't see (tenant-scoped read) → 404
//   - a site with cloud auth off → 409 SITE_CLOUD_AUTH_DISABLED: the bridge
//     would send that site no credential, and the read would fail with an
//     error naming the wrong cause.
// pegII failures surface as PegiiApiError for the caller's error mapping.
// ---------------------------------------------------------------------------

import type { Context } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { createCompanyRepository, type CompanyRow } from '../repositories/company.repository'
import { createCompanyMembershipRepository } from '../repositories/company-membership.repository'
import { planMembershipSync, type AmbiguousMatch } from '../services/company-membership-sync'
import { resolveSalesmanGateway } from '../gateways/salesman-gateway.factory'
import { resolvePegiiCaller } from './pegii-request-context'
import type { SalesmanRecord } from '../services/pegii-salesmen'

/** A refusal before any pegII call, with the HTTP status and code to answer. */
export class CompanyDirectoryRefused extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: 'NOT_FOUND' | 'SITE_CLOUD_AUTH_DISABLED',
    message: string,
  ) {
    super(message)
    this.name = 'CompanyDirectoryRefused'
  }
}

export async function readCompanyDirectory(
  c: Context<AppEnv>,
  companyId: string,
  opts: { active?: boolean } = {},
): Promise<{ company: CompanyRow; directory: SalesmanRecord[] }> {
  const db = c.get('db') as PrismaClient
  const companies = createCompanyRepository(db)
  const company = await companies.findCompany(companyId)
  if (!company) throw new CompanyDirectoryRefused(404, 'NOT_FOUND', 'company not found')

  const site = await companies.findSite(company.siteId)
  if (!site?.cloudAuthEnabled) {
    throw new CompanyDirectoryRefused(
      409,
      'SITE_CLOUD_AUTH_DISABLED',
      "cloud auth is not enabled for this company's site; enable it before reading its employees",
    )
  }

  const gateway = await resolveSalesmanGateway(db, c.get('tenantId'), () =>
    resolvePegiiCaller(c, { companyId }),
  )
  const directory = await gateway.listSalesmen(
    opts.active !== undefined ? { active: opts.active } : {},
  )
  return { company, directory }
}

export interface MembershipSyncSummary {
  employees: number
  linked: number
  newlyLinked: number
  deactivated: number
  unmatched: number
  ambiguous: number
  unmatchedUserIds: string[]
  ambiguousMatches: AmbiguousMatch[]
}

/** Plan and apply the company's membership sync against a directory already read. */
export async function syncCompanyMemberships(
  db: PrismaClient,
  tenantId: string,
  companyId: string,
  directory: SalesmanRecord[],
): Promise<MembershipSyncSummary> {
  const memberships = createCompanyMembershipRepository(db)
  const now = new Date()
  const plan = planMembershipSync({
    directory: directory.map((s) => ({
      code: Number(s.id),
      email: s.email,
      winUsername: s.winUsername,
      active: s.active,
      dateTerminated: s.dateTerminated,
    })),
    users: await memberships.listSyncUsers(tenantId),
    existing: await memberships.listExisting(companyId),
    now,
  })
  await memberships.applyPlan(tenantId, companyId, plan, now)
  return {
    employees: directory.length,
    linked: plan.linked,
    newlyLinked: plan.newlyLinked,
    deactivated: plan.deactivated,
    unmatched: plan.unmatchedUserIds.length,
    ambiguous: plan.ambiguous.length,
    unmatchedUserIds: plan.unmatchedUserIds,
    ambiguousMatches: plan.ambiguous,
  }
}
