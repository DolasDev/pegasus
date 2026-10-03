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
// PEGII_PRINCIPAL_UNRESOLVED — so a site that doesn't verify cloud tokens yet
// keeps working through the legacy credential path.
//
// The company is the tenant's default company (I1 has no per-call company
// selection; the SDK `company=` parameter comes later). A tenant wired to pegII
// after the backfill gets its Primary site + default company on first use.
// Every read goes through the tenant-scoped client, so a cross-tenant company
// or site — and therefore a cross-tenant `cid`/`aud` — can't be resolved.
// ---------------------------------------------------------------------------

import type { Context } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { createCompanyRepository } from '../repositories/company.repository'
import type { PegiiTokenCompany, PegiiTokenPrincipal } from './pegii-token'

export interface PegiiCaller {
  tenantId: string
  correlationId: string
  principal: PegiiTokenPrincipal
  /** `cloudAuthEnabled` is the operator switch — see Site in schema.prisma. */
  site: { id: string; cloudAuthEnabled: boolean }
  company: PegiiTokenCompany & { id: string; code: string }
}

export async function resolvePegiiCaller(c: Context<AppEnv>): Promise<PegiiCaller> {
  const tenantId = c.get('tenantId')
  const db = c.get('db') as PrismaClient
  const tenantUserId = c.get('apiClient')?.actsAsUserId ?? c.get('userId') ?? null

  const user = tenantUserId
    ? await db.tenantUser.findFirst({
        where: { id: tenantUserId, tenantId },
        select: { id: true, isServiceAccount: true },
      })
    : null

  const repo = createCompanyRepository(db)
  let target = await repo.getDefaultTarget()
  if (!target) {
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    })
    if (!tenant) throw new Error(`tenant ${tenantId} not found while resolving the pegII caller`)
    target = await repo.ensureDefaultTarget(tenant)
  }

  return {
    tenantId,
    correlationId: c.get('correlationId') ?? 'unknown',
    principal: {
      tenantUserId: user?.id ?? null,
      isServiceAccount: user?.isServiceAccount ?? false,
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
