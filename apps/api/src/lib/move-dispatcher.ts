// ---------------------------------------------------------------------------
// The move's dispatcher — who an `operations` task and a driver's Blocked
// notification go to (task queue plan Phase 3a D1/D4; Steve 2026-11-19/20).
//
// The dispatcher is `sales.operations_id`: the salesman code the trip save
// cascades onto every order of a trip, and that the shipments/activities lists
// filter on. Cloud identity (I3) links a salesman code to a TenantUser through a
// LINKED CompanyMembership in the order's company.
//
// One legacy read per call (a single-row SELECT through the mssql executor).
// Never call it on a read path or a timer.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { executeSql } from './mssql-executor-client'
import { legacyConnectionString } from './chat-access'

export type MoveDispatcher =
  /** The order has a dispatcher; `tenantUserId` is null when no active cloud user is linked to them. */
  | { found: true; employeeCode: number; tenantUserId: string | null }
  /** No sales row, or its operations_id is empty / 0 / not a code. */
  | { found: false }

/** Reads `sales.operations_id` for one order; null when there is none. */
export type ReadOperationsId = (orderNum: number) => Promise<unknown>

export class MoveDispatcherUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoveDispatcherUnavailableError'
  }
}

const OPERATIONS_ID_SQL = 'SELECT TOP (1) operations_id FROM sales WHERE order_num = @order_num'

/** The production reader: the tenant's legacy DB through the executor Lambda. */
export function legacyOperationsIdReader(tenantId: string): ReadOperationsId {
  return async (orderNum) => {
    const conn = await legacyConnectionString(tenantId)
    if (!conn) {
      throw new MoveDispatcherUnavailableError(
        `tenant ${tenantId} has no legacy database configured; the move's dispatcher can't be read`,
      )
    }
    const { recordset } = await executeSql(conn, OPERATIONS_ID_SQL, {
      params: [{ name: 'order_num', value: orderNum }],
    })
    return (recordset[0] as Record<string, unknown> | undefined)?.['operations_id'] ?? null
  }
}

/** `operations_id` is varchar on some sites and int on others; anything but a positive code is "none". */
export function toEmployeeCode(raw: unknown): number | null {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d{1,9}$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

export interface ResolveMoveDispatcherArgs {
  db: PrismaClient
  tenantId: string
  /**
   * The company whose employee codes the order's database uses. Null when the
   * tenant has no company yet: nobody can be linked, so a dispatcher found on
   * the order resolves to no cloud user.
   */
  companyId: string | null
  orderNum: number
  readOperationsId: ReadOperationsId
}

export async function resolveMoveDispatcher(
  args: ResolveMoveDispatcherArgs,
): Promise<MoveDispatcher> {
  const employeeCode = toEmployeeCode(await args.readOperationsId(args.orderNum))
  if (employeeCode === null) return { found: false }
  if (args.companyId === null) return { found: true, employeeCode, tenantUserId: null }

  // CompanyMembership and TenantUser aren't auto-scoped: bind tenantId explicitly.
  const membership = await args.db.companyMembership.findFirst({
    where: {
      tenantId: args.tenantId,
      companyId: args.companyId,
      employeeCode,
      status: 'LINKED',
      tenantUser: {
        tenantId: args.tenantId,
        status: { not: 'DEACTIVATED' },
        isServiceAccount: false,
      },
    },
    select: { tenantUserId: true },
    orderBy: { updatedAt: 'desc' },
  })
  return { found: true, employeeCode, tenantUserId: membership?.tenantUserId ?? null }
}
