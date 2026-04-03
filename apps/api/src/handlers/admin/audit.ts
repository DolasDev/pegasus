// ---------------------------------------------------------------------------
// Audit log helper — platform.audit_logs
//
// Every mutation performed by a platform administrator is recorded here.
// Callers MUST await inside a Prisma $transaction so audit entries are
// committed atomically with the resource change they describe.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'

/**
 * Appends an immutable audit log entry to the platform schema.
 *
 * Must be called inside a Prisma interactive transaction so the log entry
 * and the underlying resource change are committed or rolled back together.
 *
 * @param tx  - The Prisma transaction client (or the global db client for
 *              reads where atomicity is not required).
 * @param sub  - Cognito `sub` claim of the acting administrator.
 * @param email - Denormalised admin email for display in the audit UI.
 * @param action - Identifier for the action (e.g. `CREATE_TENANT`).
 * @param resourceType - Type of the affected resource (e.g. `TENANT`).
 * @param resourceId - Primary key of the affected resource.
 * @param before - Snapshot of the resource before the change (null for creates).
 * @param after - Snapshot of the resource after the change (null for hard deletes).
 * @param req - Optional Hono request object used to extract IP / UA.
 */
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  sub: string,
  email: string,
  action: string,
  resourceType: string,
  resourceId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue | null,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      adminSub: sub,
      adminEmail: email,
      action,
      resourceType,
      resourceId,
      before: before ?? Prisma.JsonNull,
      after: after ?? Prisma.JsonNull,
      ...(ipAddress !== undefined ? { ipAddress } : {}),
      ...(userAgent !== undefined ? { userAgent } : {}),
    },
  })
}
