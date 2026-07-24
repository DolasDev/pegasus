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
    /**
     * List all human TenantUsers for a tenant, ordered by invitedAt descending.
     *
     * Service accounts (`isServiceAccount = true` — the synthetic
     * `svc-<uuid>@svc.invalid` principals an ApiClient acts as) are excluded:
     * they are machine identities managed through the API-keys surface, not
     * people, and must never appear on the user-management roster. This filter
     * is the single choke point for `GET /users` and the platform-admin
     * per-tenant user view (both call this method).
     */
    listByTenant(tenantId: string): Promise<TenantUserRow[]> {
      return db.tenantUser.findMany({
        where: { tenantId, isServiceAccount: false },
        select: USER_SELECT,
        orderBy: { invitedAt: 'desc' },
      })
    },

    /**
     * Find a human TenantUser by ID within a specific tenant (ownership check).
     * Service accounts are invisible here too, so the user-management handlers
     * (patch roles / deactivate / link crew) 404 rather than mutating a
     * machine principal.
     */
    findById(id: string, tenantId: string): Promise<TenantUserRow | null> {
      return db.tenantUser.findFirst({
        where: { id, tenantId, isServiceAccount: false },
        select: USER_SELECT,
      })
    },

    /** Find a human TenantUser by email within a specific tenant. */
    findByEmail(email: string, tenantId: string): Promise<TenantUserRow | null> {
      return db.tenantUser.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          tenantId,
          isServiceAccount: false,
        },
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

    /**
     * Count human tenant_admin users for the tenant — used to prevent
     * last-admin lockout. Service accounts are excluded: an API key granted the
     * `tenant_admin` role is not a person who can recover the account, so it
     * must not mask the "last real admin" condition.
     */
    countAdmins(tenantId: string): Promise<number> {
      return db.tenantUser.count({
        where: {
          tenantId,
          isServiceAccount: false,
          roleNames: { has: 'tenant_admin' },
          status: { not: 'DEACTIVATED' },
        },
      })
    },
  }
}

export type UsersRepository = ReturnType<typeof createUsersRepository>
