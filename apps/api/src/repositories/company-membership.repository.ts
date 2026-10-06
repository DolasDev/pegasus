// ---------------------------------------------------------------------------
// CompanyMembership repository (cloud identity I3).
//
// CompanyMembership is in TENANT_SCOPED_MODELS, so its reads/updates are scoped
// by the Prisma extension; creates pass tenantId explicitly. TenantUser is NOT
// tenant-scoped (INTENTIONALLY_UNSCOPED in the isolation suite), so every user
// read here names `tenantId` itself.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type {
  ExistingMembership,
  MembershipSyncPlan,
  SyncUser,
} from '../services/company-membership-sync'

export type MembershipView = {
  id: string
  tenantUserId: string
  email: string
  employeeCode: number
  legacyWindowsUsername: string | null
  status: 'LINKED' | 'INACTIVE'
  matchedBy: 'EMAIL' | 'WIN_USERNAME'
  lastSyncedAt: Date
}

export type MemberUser = { id: string; email: string; legacyWindowsUsername: string | null }

export function createCompanyMembershipRepository(db: PrismaClient) {
  /** Users the sync considers: humans who aren't deactivated. */
  function listSyncUsers(tenantId: string): Promise<SyncUser[]> {
    return db.tenantUser.findMany({
      where: { tenantId, isServiceAccount: false, status: { not: 'DEACTIVATED' } },
      select: { id: true, email: true, legacyWindowsUsername: true },
      orderBy: { email: 'asc' },
    })
  }

  return {
    listSyncUsers,

    /** Every human user's email (any status) — to mark employees who already have a login. */
    listUserEmails(tenantId: string): Promise<Array<{ id: string; email: string }>> {
      return db.tenantUser.findMany({
        where: { tenantId, isServiceAccount: false },
        select: { id: true, email: true },
      })
    },

    async listExisting(companyId: string): Promise<ExistingMembership[]> {
      return db.companyMembership.findMany({
        where: { companyId },
        select: { tenantUserId: true, employeeCode: true, status: true },
      })
    },

    /** The LINKED membership a token for (company, user) carries `emp`/`wun` from. */
    findLinked(
      companyId: string,
      tenantUserId: string,
    ): Promise<{ employeeCode: number; legacyWindowsUsername: string | null } | null> {
      return db.companyMembership.findFirst({
        where: { companyId, tenantUserId, status: 'LINKED' },
        select: { employeeCode: true, legacyWindowsUsername: true },
      })
    },

    /** The admin view: every membership row, plus the users with no LINKED row. */
    async listForCompany(
      tenantId: string,
      companyId: string,
    ): Promise<{ members: MembershipView[]; unmatched: MemberUser[] }> {
      const rows = await db.companyMembership.findMany({
        where: { companyId },
        orderBy: [{ status: 'asc' }, { employeeCode: 'asc' }],
      })
      const users = await listSyncUsers(tenantId)
      const emailById = new Map(
        (
          await db.tenantUser.findMany({
            where: { tenantId, id: { in: rows.map((r) => r.tenantUserId) } },
            select: { id: true, email: true },
          })
        ).map((u) => [u.id, u.email]),
      )
      const linked = new Set(rows.filter((r) => r.status === 'LINKED').map((r) => r.tenantUserId))
      return {
        members: rows.map((r) => ({
          id: r.id,
          tenantUserId: r.tenantUserId,
          email: emailById.get(r.tenantUserId) ?? '',
          employeeCode: r.employeeCode,
          legacyWindowsUsername: r.legacyWindowsUsername,
          status: r.status,
          matchedBy: r.matchedBy,
          lastSyncedAt: r.lastSyncedAt,
        })),
        unmatched: users.filter((u) => !linked.has(u.id)),
      }
    },

    /**
     * Apply a sync plan atomically: release every LINKED row that changes first
     * (see MembershipSyncPlan.releaseUserIds), then upsert the writes.
     */
    async applyPlan(
      tenantId: string,
      companyId: string,
      plan: MembershipSyncPlan,
      now: Date,
    ): Promise<void> {
      await db.$transaction(async (tx) => {
        if (plan.releaseUserIds.length > 0) {
          await tx.companyMembership.updateMany({
            where: { companyId, tenantUserId: { in: plan.releaseUserIds }, status: 'LINKED' },
            data: { status: 'INACTIVE', lastSyncedAt: now },
          })
        }
        for (const w of plan.writes) {
          const data = {
            employeeCode: w.employeeCode,
            legacyWindowsUsername: w.legacyWindowsUsername,
            status: w.status,
            matchedBy: w.matchedBy,
            lastSyncedAt: now,
          }
          const { count } = await tx.companyMembership.updateMany({
            where: { companyId, tenantUserId: w.tenantUserId },
            data,
          })
          if (count === 0) {
            await tx.companyMembership.create({
              data: { tenantId, companyId, tenantUserId: w.tenantUserId, ...data },
            })
          }
        }
      })
    },
  }
}

export type CompanyMembershipRepository = ReturnType<typeof createCompanyMembershipRepository>
