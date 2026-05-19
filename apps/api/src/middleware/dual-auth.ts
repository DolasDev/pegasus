// ---------------------------------------------------------------------------
// Dual authentication middleware
//
// Most /api/v1 routes are reached by exactly one kind of caller: a human in a
// browser (Cognito ID token) or an automated integration (vnd_ vendor key).
// The workflows API is the first route reached by BOTH — the tenant SPA lists
// and downloads workflows with a Cognito session, while the Python SDK CLI
// uploads them under a workflow_developer service-account vendor key.
//
// This middleware dispatches on the Authorization header:
//   - Bearer vnd_*   → m2mAppAuthMiddleware (vendor key → service-account principal)
//   - anything else  → tenantMiddleware     (Cognito ID token)
//   - SKIP_AUTH=true  → skipAuthMiddleware  (local-dev bypass, checked first)
//
// All three downstream middlewares populate the identical AppEnv context
// (tenantId, principal, db, userId, idToken, policyStoreId), so handlers and
// requirePermission stay oblivious to which path authenticated the request.
//
// A handler mounted with this middleware MUST be routed before the Cognito
// `v1` block in app.ts (which applies tenantMiddleware as a wildcard) —
// otherwise a vnd_ request is rejected by tenantMiddleware before it arrives.
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'
import { tenantMiddleware } from './tenant'
import { m2mAppAuthMiddleware } from './m2m-app-auth'
import { skipAuthMiddleware } from './skip-auth'

export const dualAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (process.env['SKIP_AUTH'] === 'true') {
    return skipAuthMiddleware(c, next)
  }

  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (token?.startsWith('vnd_')) {
    return m2mAppAuthMiddleware(c, next)
  }

  return tenantMiddleware(c, next)
}
