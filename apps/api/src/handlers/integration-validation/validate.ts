// ---------------------------------------------------------------------------
// POST /api/v1/integrations/:integrationId/validate — the synchronous
// validation endpoint. A standalone, out-of-process surface that validates an
// order's state against an integration's declarative rules (POC plan).
//
// AUTH: API-key (M2M). Any valid, non-revoked `vnd_` key from ANY tenant is
// accepted — auth is applied as route-level middleware so it only runs on this
// exact route and other /integrations/* paths (e.g. the tenant-auth
// /integrations/ringcentral routes) still fall through. The validator is
// STATELESS and reads no tenant data, so no scope or per-tenant restriction is
// applied beyond "the key is valid".
//
// Contract:
//   200 { valid, issues[], degraded }  — validation ran (degraded=true ⇒ failed
//                                          open internally; caller may proceed).
//   400 { error, code, correlationId } — request body wasn't valid JSON.
//   401 { error, code }                — missing/invalid API key.
//   403 { error, code }                — API key revoked.
//   404 { error, code, correlationId } — unknown integrationId.
//
// validateOrder fails open, so a validator defect never 5xxs the caller.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { z } from 'zod'
import { apiClientAuthMiddleware } from '../../middleware/api-client-auth'
import type { ApiClientVariables } from '../../types'
import { validateOrder, UnknownIntegrationError } from '../../integration-validation/validate'
import type { ValidationInput } from '../../integration-validation/types'

// correlationId is injected by the root correlationMiddleware on every request;
// declare it alongside the API-key vars this route relies on.
type IntegrationValidationEnv = { Variables: ApiClientVariables & { correlationId: string } }

const ValidateBody = z.object({
  order: z.unknown(),
  prior: z.unknown().optional(),
  action: z.enum(['save', 'cancel', 'status-change']).optional(),
})

export const integrationValidationHandler = new Hono<IntegrationValidationEnv>()

integrationValidationHandler.post(
  '/integrations/:integrationId/validate',
  apiClientAuthMiddleware,
  async (c) => {
    const correlationId = c.get('correlationId')
    const integrationId = c.req.param('integrationId') ?? ''

    const parsed = ValidateBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: parsed.error.message, code: 'VALIDATION_ERROR', correlationId }, 400)
    }

    try {
      const result = validateOrder(integrationId, parsed.data as ValidationInput)
      return c.json(result)
    } catch (err) {
      if (err instanceof UnknownIntegrationError) {
        return c.json({ error: err.message, code: 'NOT_FOUND', correlationId }, 404)
      }
      throw err
    }
  },
)
