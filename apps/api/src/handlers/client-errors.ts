// ---------------------------------------------------------------------------
// Client error reporting — POST /api/v1/client-errors
//
// A tenant-web render crash shows "Something went wrong" from
// components/ErrorBoundary.tsx and, until this endpoint existed, left NO trace
// anywhere on the server: the boundary only called console.error, and the
// QueryClient does not set `throwOnError`, so a failed request never reaches it
// either. On 2026-09-17 a user reported exactly that message on the Operations
// screens and CloudWatch could not explain it — there was nothing to find.
//
// This endpoint's only job is to turn that silence into one searchable log line:
//
//   fields @timestamp, message, url, userId, tenantId
//     | filter message = 'client.error'
//
// Deliberately NOT a permission-gated route: any authenticated user may report
// a crash in their own browser. It is mounted under v1, so tenantMiddleware has
// already authenticated the caller and requestTimingMiddleware stamps
// userId/tenantId onto the same correlationId.
//
// KNOWN GAP: a crash on /login happens before there is a token, so it cannot be
// reported here. Widening this to an unauthenticated route would create a
// public, unthrottled way to write attacker-controlled strings into our logs;
// that trade is not worth it for the login page alone.
//
// No database write. These are diagnostic breadcrumbs, not durable records —
// CloudWatch retention is the right lifetime for them.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { logger } from '../lib/logger'

// Every field is capped server-side. The client also truncates, but a hostile
// or looping client must not be able to write an unbounded string into a log
// line we pay to store — so the cap is enforced where it cannot be bypassed.
// `.catch()` truncates rather than rejecting: a crash report that arrives
// slightly too long is still worth having, and a 400 would discard the only
// evidence of the very failure we are trying to see.
const capped = (max: number) =>
  z
    .string()
    .transform((s) => s.slice(0, max))
    .catch('')

const ClientErrorBody = z.object({
  /** The thrown error's message. Required — a report without one says nothing. */
  message: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 500)),
  /** JS stack. For a failed dynamic import this names the missing chunk, which
   *  is how a stale-bundle crash is recognised. */
  stack: capped(4000).optional(),
  /** React component stack from ErrorBoundary's ErrorInfo. */
  componentStack: capped(4000).optional(),
  /** Where it happened — the SPA route the user was on. */
  url: capped(500).optional(),
  userAgent: capped(300).optional(),
})

export const clientErrorsHandler = new Hono<AppEnv>()

// ---------------------------------------------------------------------------
// POST /
//
// Response: 204 No Content — the client has nothing to do with a reply, and a
//           body would invite the reporter to branch on it.
//           { error, code: VALIDATION_ERROR } (400) — unusable report
// ---------------------------------------------------------------------------
clientErrorsHandler.post(
  '/',
  validator('json', (value, c) => {
    const r = ClientErrorBody.safeParse(value)
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  (c) => {
    const body = c.req.valid('json')

    // ERROR level: this is a user-visible crash, and it should surface in the
    // same queries as server-side errors. correlationId, method, path, userId
    // and tenantId are attached by the surrounding middleware.
    logger.error('client.error', {
      clientMessage: body.message,
      ...(body.stack ? { stack: body.stack } : {}),
      ...(body.componentStack ? { componentStack: body.componentStack } : {}),
      ...(body.url ? { url: body.url } : {}),
      ...(body.userAgent ? { userAgent: body.userAgent } : {}),
    })

    return c.body(null, 204)
  },
)
