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
  legacyWindowsUsername: string | null
  /** Legacy longhaul driver id (v_longhaul_drivers.driver_id) this login maps to. */
  longhaulDriverId: number | null
  roleNames: string[]
  status: 'PENDING' | 'ACTIVE' | 'DEACTIVATED'
  invitedAt: Date
  activatedAt: Date | null
  deactivatedAt: Date | null
  /** The CrewMember linked to this login, when one exists (driver persona). */
  crewMember: { id: string; name: string } | null
}

const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  cognitoSub: true,
  legacyWindowsUsername: true,
  longhaulDriverId: true,
  roleNames: true,
  status: true,
  invitedAt: true,
  activatedAt: true,
  deactivatedAt: true,
  crewMember: { select: { id: true, name: true } },
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
        where: { email: { equals: email, mode: 'insensitive' }, tenantId },
        select: USER_SELECT,
      })
    },

    /**
     * Create a new invited TenantUser with PENDING status. The legacy `role`
     * enum is left at its column default (`USER`) — it's no longer read by
     * any API code path; final removal is gated on the migration in
     * plans/in-progress/authz-cedar-avp-followups.md item #6.
     */
    invite(tenantId: string, email: string, roleNames: string[]): Promise<TenantUserRow> {
      return db.tenantUser.create({
        data: { tenantId, email: email.toLowerCase(), roleNames },
        select: USER_SELECT,
      })
    },

    /** Update the Cedar role-group memberships of a TenantUser. */
    updateRoleNames(id: string, roleNames: string[]): Promise<TenantUserRow> {
      return db.tenantUser.update({
        where: { id },
        data: { roleNames },
        select: USER_SELECT,
      })
    },

    /** Set or clear the legacy SQL Server Windows username for a TenantUser. */
    updateLegacyWindowsUsername(
      id: string,
      legacyWindowsUsername: string | null,
    ): Promise<TenantUserRow> {
      return db.tenantUser.update({
        where: { id },
        data: { legacyWindowsUsername },
        select: USER_SELECT,
      })
    },

    /** Set or clear the legacy longhaul driver id for a TenantUser. */
    updateLonghaulDriverId(id: string, longhaulDriverId: number | null): Promise<TenantUserRow> {
      return db.tenantUser.update({
        where: { id },
        data: { longhaulDriverId },
        select: USER_SELECT,
      })
    },

    /**
     * Link this TenantUser to a CrewMember, or unlink it when `crewMemberId`
     * is null. `CrewMember.tenantUserId` is unique, so any prior link is
     * released first — reassigning a login from one crew member to another
     * must free the old crew member before the new one can claim it. Both
     * writes run in one transaction; both are tenant-scoped by the extension.
     */
    linkCrewMember(tenantUserId: string, crewMemberId: string | null): Promise<unknown> {
      const releasePrior = db.crewMember.updateMany({
        where: { tenantUserId },
        data: { tenantUserId: null },
      })
      if (crewMemberId === null) {
        return releasePrior
      }
      return db.$transaction([
        releasePrior,
        db.crewMember.update({ where: { id: crewMemberId }, data: { tenantUserId } }),
      ])
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

    /** Count tenant_admin users for the tenant — used to prevent last-admin lockout. */
    countAdmins(tenantId: string): Promise<number> {
      return db.tenantUser.count({
        where: {
          tenantId,
          roleNames: { has: 'tenant_admin' },
          status: { not: 'DEACTIVATED' },
        },
      })
    },
  }
}

export type UsersRepository = ReturnType<typeof createUsersRepository>
