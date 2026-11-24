// ---------------------------------------------------------------------------
// Who is calling pegII, for which company — resolved once per request.
//
// Cloud-issued pegII tokens are minted on behalf of the request's principal
// (plans/todo/cloud-identity-and-companies.md, D-I1/D-I2):
//   - an M2M / workflow-runtime call acts as its ApiClient's service-account
//     TenantUser (`apiClient.actsAsUserId`),
//   - a Cognito call acts as the signed-in TenantUser (`userId`).
// Either may be unresolved (a legacy ApiClient row with no acts-as user, a
// first-login race); the caller still resolves, and minting refuses later with
// PEGII_PRINCIPAL_UNRESOLVED. There is no other credential: a site that doesn't
// verify cloud tokens is refused with PEGII_API_CAPABILITY_MISSING.
//
// The company is the tenant's default company unless the caller names one
// (`opts.companyId` — the I3 membership sync, which reads each company's
// directory). Workflows have no per-call company selection yet; the SDK
// `company=` parameter comes later. A tenant wired to pegII after the backfill
// gets its Primary site + default company on first use.
//
// A human user with a LINKED CompanyMembership in the target company carries
// it as `emp`/`wun` (attribution only, D-I1); service accounts take the
// company's systemEmployeeCode in the minter instead.
// Every read goes through the tenant-scoped client, so a cross-tenant company
// or site — and therefore a cross-tenant `cid`/`aud` — can't be resolved.
// ---------------------------------------------------------------------------

import type { Context } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { createCompanyRepository, type CompanyTarget } from '../repositories/company.repository'
import { createCompanyMembershipRepository } from '../repositories/company-membership.repository'
import type { PegiiTokenCompany, PegiiTokenPrincipal } from './pegii-token'

export interface PegiiCaller {
  tenantId: string
  correlationId: string
  principal: PegiiTokenPrincipal
  /** `cloudAuthEnabled` is the operator switch — see Site in schema.prisma. */
  site: { id: string; cloudAuthEnabled: boolean }
  company: PegiiTokenCompany & { id: string; code: string }
}

/** Who to act as, without a request: what {@link buildPegiiCaller} needs. */
export interface PegiiCallerInput {
  tenantId: string
  /** The TenantUser to act as (a human, or a service account); null when unresolved. */
  tenantUserId: string | null
  correlationId: string
  /** Name a company; default: the tenant's default company. */
  companyId?: string
}

/**
 * Resolve a pegII caller from plain values — for code with no request, such as a
 * scheduled Lambda (the task sweeper acts as an awaiting Workflow's runtime
 * service account). {@link resolvePegiiCaller} is this plus the request's values.
 *
 * `tenantDb` MUST be scoped to `input.tenantId` (`createTenantDb`): the default
 * company lookup carries no tenantId of its own, so on the root client it would
 * find ANY tenant's default company — and mint a token for its site.
 */
export async function buildPegiiCaller(
  tenantDb: PrismaClient,
  input: PegiiCallerInput,
): Promise<PegiiCaller> {
  const { tenantId, tenantUserId, correlationId } = input
  const db = tenantDb

  const user = tenantUserId
    ? await db.tenantUser.findFirst({
        where: { id: tenantUserId, tenantId },
        select: { id: true, isServiceAccount: true },
      })
    : null

  const repo = createCompanyRepository(db)
  let target: CompanyTarget | null
  if (input.companyId) {
    // Tenant-scoped reads: another tenant's company id resolves to nothing.
    const company = await repo.findCompany(input.companyId)
    const site = company ? await repo.findSite(company.siteId) : null
    if (!company || !site) {
      throw new Error(`company ${input.companyId} not found while resolving the pegII caller`)
    }
    target = { company, site }
  } else {
    target = await repo.getDefaultTarget()
  }
  if (!target) {
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    })
    if (!tenant) throw new Error(`tenant ${tenantId} not found while resolving the pegII caller`)
    target = await repo.ensureDefaultTarget(tenant)
  }

  const attribution =
    user && !user.isServiceAccount
      ? await createCompanyMembershipRepository(db).findLinked(target.company.id, user.id)
      : null

  return {
    tenantId,
    correlationId,
    principal: {
      tenantUserId: user?.id ?? null,
      isServiceAccount: user?.isServiceAccount ?? false,
      attribution: attribution
        ? {
            employeeCode: attribution.employeeCode,
            windowsUsername: attribution.legacyWindowsUsername,
          }
        : null,
    },
    site: { id: target.site.id, cloudAuthEnabled: target.site.cloudAuthEnabled },
    company: {
      id: target.company.id,
      code: target.company.code,
      dataSourceKey: target.company.dataSourceKey,
      systemEmployeeCode: target.company.systemEmployeeCode,
    },
  }
}

/** The pegII caller for this request: its tenant-scoped db, principal and correlation id. */
export async function resolvePegiiCaller(
  c: Context<AppEnv>,
  opts: { companyId?: string } = {},
): Promise<PegiiCaller> {
  return buildPegiiCaller(c.get('db') as PrismaClient, {
    tenantId: c.get('tenantId'),
    tenantUserId: c.get('apiClient')?.actsAsUserId ?? c.get('userId') ?? null,
    correlationId: c.get('correlationId') ?? 'unknown',
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
  })
}
