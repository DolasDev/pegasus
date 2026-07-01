// ---------------------------------------------------------------------------
// CustomerGateway factory — picks the read data source for a tenant.
//
//   Tenant.customerSource null/'prisma' → Prisma repo (cloud Postgres, default)
//   Tenant.customerSource 'pegii'       → pegII on-prem domain API over tunnel
//
// The default path wraps the existing customer.repository.ts free functions
// verbatim, so behaviour is byte-identical to today unless a tenant is
// explicitly opted in. Tenant and VpnPeer are NOT tenant-scoped models, so the
// request-scoped db is safe for the config + overlay lookups; Customer IS
// scoped, so the Prisma path retains tenant isolation.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { CustomerGateway } from './customer.gateway'
import { createPegiiCustomerGateway } from './pegii-customer.gateway'
// Imported from the repositories barrel (not the module) so the default path
// shares the same seam handlers use — and so barrel-level test mocks intercept it.
import {
  findCustomerById,
  findCustomerByEmail,
  listCustomers,
  countCustomers,
} from '../repositories'
import { normalizeCustomerSource } from '../lib/customer-source-config'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { PegiiApiError } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

/** Wraps the Prisma repository functions as a CustomerGateway (default path). */
function createPrismaCustomerGateway(db: PrismaClient): CustomerGateway {
  return {
    findCustomerById: (id) => findCustomerById(db, id),
    findCustomerByEmail: (email) => findCustomerByEmail(db, email),
    listCustomers: (opts) => listCustomers(db, opts ?? {}),
    countCustomers: () => countCustomers(db),
  }
}

/**
 * Resolve the CustomerGateway for a tenant. Reads Tenant.customerSource; when
 * 'pegii', resolves the on-prem base URL + credential and returns the
 * pegII-backed gateway. Throws PegiiApiError('PEGII_API_NOT_CONFIGURED', ...)
 * if a tenant is flagged 'pegii' but has no reachable target, so the caller can
 * surface a stable error rather than silently degrading.
 */
export async function resolveCustomerGateway(
  db: PrismaClient,
  tenantId: string,
): Promise<CustomerGateway> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { customerSource: true },
  })

  const source = normalizeCustomerSource(tenant?.customerSource)
  if (source !== 'pegii') {
    return createPrismaCustomerGateway(db)
  }

  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    logger.warn('pegII customer source unavailable — falling back is not permitted', {
      tenantId,
      code: resolved.code,
    })
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} is set to customerSource=pegii but ${resolved.message}`,
    )
  }

  return createPegiiCustomerGateway({
    tenantId,
    baseUrl: resolved.target.base,
    apiKey: resolved.target.apiKey,
  })
}
