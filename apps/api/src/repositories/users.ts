// ---------------------------------------------------------------------------
// Tenant user repository
//
// Manages the TenantUser roster — the explicit list of invited users for a
// given tenant. Every user who authenticates via Cognito must have a matching
// record here (enforced by the Pre-Token-Generation Lambda).
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TenantUserRow = {
  id: string
  tenantId: string
  email: string
  cognitoSub: string | null
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  invitedAt: Date
  activatedAt: Date | null
  deactivatedAt: Date | null
}

const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  cognitoSub: true,
  role: true,
  status: true,
  invitedAt: true,
  activatedAt: true,
  deactivatedAt: true,
} as const

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export function createUsersRepository(db: PrismaClient) {
  return {
    /** List all TenantUsers for a tenant, ordered by invitedAt descending. */
    listByTenant(tenantId: string): Promise<TenantUserRow[]> {
      return db.tenantUser.findMany({
        where: { tenantId },
        select: USER_SELECT,
        orderBy: { invitedAt: 'desc' },
      })
    },

    /** Find a TenantUser by ID within a specific tenant (ownership check). */
    findById(id: string, tenantId: string): Promise<TenantUserRow | null> {
      return db.tenantUser.findFirst({
        where: { id, tenantId },
        select: USER_SELECT,
      })
    },

    /** Find a TenantUser by email within a specific tenant. */
    findByEmail(email: string, tenantId: string): Promise<TenantUserRow | null> {
      return db.tenantUser.findFirst({
        where: { email, tenantId },
        select: USER_SELECT,
      })
    },

    /** Create a new invited TenantUser with PENDING status. */
    invite(tenantId: string, email: string, role: 'ADMIN' | 'USER'): Promise<TenantUserRow> {
      return db.tenantUser.create({
        data: { tenantId, email, role },
        select: USER_SELECT,
      })
    },

    /** Update the role of a TenantUser. */
    updateRole(id: string, role: 'ADMIN' | 'USER'): Promise<TenantUserRow> {
      return db.tenantUser.update({
        where: { id },
        data: { role },
        select: USER_SELECT,
      })
    },

    /** Deactivate a TenantUser — prevents future logins. */
    deactivate(id: string): Promise<TenantUserRow> {
      return db.tenantUser.update({
        where: { id },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
        select: USER_SELECT,
      })
    },

    /** Reactivate a deactivated TenantUser — restores login access. */
    reactivate(id: string): Promise<TenantUserRow> {
      return db.tenantUser.update({
        where: { id },
        data: { status: 'ACTIVE', deactivatedAt: null },
        select: USER_SELECT,
      })
    },

    /** Count ADMIN users for the tenant — used to prevent last-admin lockout. */
    countAdmins(tenantId: string): Promise<number> {
      return db.tenantUser.count({
        where: { tenantId, role: 'ADMIN', status: { not: 'DEACTIVATED' } },
      })
    },
  }
}

export type UsersRepository = ReturnType<typeof createUsersRepository>
