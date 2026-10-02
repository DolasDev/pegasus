// ---------------------------------------------------------------------------
// /api/v1/usage — the tenant's billable automated actions against its plan
// (PegasusClient.get_usage_summary; tenant-web Settings → Developer → Usage).
//
//   GET /summary?year=YYYY   ReadUsage   the term in effect (or the term that
//                                         started in `year`); see
//                                         lib/usage/usage-summary.ts
//
// Dual auth: on Cognito, ReadUsage is held only by tenant_admin (a billing
// view); the workflow_runtime `vnd_` key holds it so a workflow can check its
// own consumption. What counts is defined in lib/usage/billable-actions.ts.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { Actions } from '../authz/actions'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { requirePermission } from '../middleware/rbac'
import { buildUsageSummary } from '../lib/usage/usage-summary'

export const SummaryQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
})

export const usageHandler = new Hono<AppEnv>()

// Mounted on the m2mV1 router (no wildcard auth) — see handlers/sms.ts.
usageHandler.use('*', dualAuthMiddleware)

usageHandler.get(
  '/summary',
  requirePermission(Actions.ReadUsage),
  validator('query', (value, c) => {
    const r = SummaryQuery.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const { year } = c.req.valid('query')
    const summary = await buildUsageSummary(c.get('db'), c.get('tenantId'), {
      ...(year !== undefined ? { year } : {}),
    })
    return c.json({ data: summary })
  },
)
