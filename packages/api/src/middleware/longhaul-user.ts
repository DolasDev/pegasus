// ---------------------------------------------------------------------------
// Longhaul user authentication middleware
//
// Two auth modes:
//
// 1. SKIP_AUTH=true (on-prem / Windows deployment):
//    - Reads the X-Windows-User header and looks up the user in
//      v_longhaul_salesman by win_username (case-insensitive).
//    - Sets c.set('longhaulUser', user) on success.
//    - Returns 403 if the user is not found or is inactive.
//
// 2. Normal mode (API key / M2M):
//    - Requires a valid API client key already set in context by
//      apiClientAuthMiddleware (called upstream on the m2mV1 router).
//    - Requires the 'longhaul:read' scope (handlers can additionally check
//      'longhaul:write' for mutating operations).
//
// In both modes: returns 503 if the longhaul MSSQL connection is not
// configured (env vars missing).
// ---------------------------------------------------------------------------

import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../types'
import { longhaulDbConfigured, getLonghaulDb } from '../lib/longhaul-db'
import { getUserByWindowsUsername } from '../repositories/longhaul/reference.repository'
import { hasScope } from '../lib/scopes'
import { logger } from '../lib/logger'

export const longhaulUserMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Check MSSQL availability first — applies to both auth modes
  if (!longhaulDbConfigured()) {
    logger.warn('Longhaul MSSQL not configured — returning 503')
    return c.json(
      {
        error: 'MSSQL not configured',
        code: 'MSSQL_UNAVAILABLE',
        correlationId: c.get('correlationId'),
      },
      503,
    )
  }

  if (process.env['SKIP_AUTH'] === 'true') {
    // On-prem mode: authenticate via Windows username header
    const winUser = c.req.header('X-Windows-User')
    if (!winUser) {
      return c.json(
        {
          error: 'Missing X-Windows-User header',
          code: 'LONGHAUL_USER_NOT_FOUND',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    let user: Record<string, unknown> | undefined
    try {
      const db = getLonghaulDb()
      user = (await getUserByWindowsUsername(db, winUser)) as Record<string, unknown> | undefined
    } catch (err) {
      logger.error('Failed to look up longhaul user', { error: String(err) })
      return c.json(
        {
          error: 'MSSQL query failed',
          code: 'MSSQL_UNAVAILABLE',
          correlationId: c.get('correlationId'),
        },
        503,
      )
    }

    if (!user) {
      return c.json(
        {
          error: 'User not authorized',
          code: 'LONGHAUL_USER_NOT_FOUND',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    if ((user['active'] as string | undefined)?.toLowerCase() !== 'y') {
      return c.json(
        {
          error: 'User not authorized',
          code: 'LONGHAUL_USER_NOT_FOUND',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }

    c.set('longhaulUser', {
      code: user['code'] as number,
      first_name: user['first_name'] as string,
      last_name: user['last_name'] as string,
      ...user,
    })
  } else {
    // M2M mode: require API client with longhaul:read scope
    const apiClient = c.get('apiClient')
    if (!apiClient) {
      return c.json(
        {
          error: 'Missing or invalid API key',
          code: 'UNAUTHORIZED',
          correlationId: c.get('correlationId'),
        },
        401,
      )
    }

    if (!hasScope('longhaul:read', apiClient.scopes)) {
      return c.json(
        {
          error: 'Forbidden: missing required scope "longhaul:read"',
          code: 'FORBIDDEN',
          correlationId: c.get('correlationId'),
        },
        403,
      )
    }
  }

  await next()
}
