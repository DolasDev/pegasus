// ---------------------------------------------------------------------------
// meterUsage — the billable-action meter (plans/completed/usage-metering.md).
//
// Mounted AFTER `requirePermission(Actions.X)` on each billable route. It does
// nothing until the handler has answered; then it records one UsageEvent when
// ALL of these hold:
//   1. the caller is an API client (`apiClient` set) — humans are never metered
//   2. the response is 2xx
//   3. no `data.already*` flag is true (an idempotent replay is free)
//   4. the action's registry entry says this response is billable
// The (tenant, action, subjectKey) unique key then makes a retry the route
// didn't flag count once.
//
// NON-FATAL: a meter failure is logged and emitted as Pegasus/Usage
// MeterWriteFailed{Action}; the handler's response goes back untouched. A
// failed meter must never fail a text. The write is awaited (Lambda freezes
// after the response, so fire-and-forget could silently drop it).
// ---------------------------------------------------------------------------

import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import type { ActionDef } from '../authz/actions'
import {
  BILLABLE_ACTIONS,
  isBillableActionId,
  workflowIdFromClientName,
} from '../lib/usage/billable-actions'
import type { ResponseData } from '../lib/usage/billable-actions'
import { emitMeterWriteFailed } from '../lib/usage/meter-metrics'
import { createUsageRepository } from '../repositories/usage.repository'
import { logger } from '../lib/logger'

function isRecord(value: unknown): value is ResponseData {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An idempotent replay: `alreadySent`, `alreadyRead`, `alreadyClosed`, `alreadyExists`, … */
function isReplay(data: ResponseData): boolean {
  return Object.entries(data).some(([key, value]) => key.startsWith('already') && value === true)
}

export function meterUsage(action: ActionDef) {
  const actionId = action.id
  if (!isBillableActionId(actionId)) {
    // A programming error, caught at module load: every metered route needs a
    // registry entry saying what it counts.
    throw new Error(`meterUsage: '${actionId}' has no entry in BILLABLE_ACTIONS`)
  }
  const def = BILLABLE_ACTIONS[actionId]

  return async (c: Context<AppEnv>, next: Next): Promise<void> => {
    await next()

    const apiClient = c.get('apiClient')
    if (!apiClient) return
    if (c.res.status < 200 || c.res.status >= 300) return

    try {
      const body: unknown = await c.res.clone().json()
      const data = isRecord(body) ? body['data'] : undefined
      if (!isRecord(data)) throw new Error('response has no data envelope')
      if (isReplay(data)) return
      if (!(await def.billable(data, c))) return

      const subjectKey = def.subjectKey(data, c)
      if (subjectKey === null)
        throw new Error('response lacks the field its subject key is built from')

      await createUsageRepository(c.get('db')).record({
        tenantId: c.get('tenantId'),
        action: actionId,
        subjectKey,
        apiClientId: apiClient.id,
        workflowId: workflowIdFromClientName(apiClient.name),
        correlationId: c.get('correlationId') ?? null,
      })
    } catch (err) {
      logger.error('Usage meter write failed', {
        action: actionId,
        tenantId: c.get('tenantId'),
        apiClientId: apiClient.id,
        error: err instanceof Error ? err.message : String(err),
      })
      await emitMeterWriteFailed(actionId)
    }
  }
}
