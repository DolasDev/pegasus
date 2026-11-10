// ---------------------------------------------------------------------------
// Assistant Lambda entry point — the streaming twin of lambda.ts.
//
// Same bundle, same Hono app, same middleware; the differences are all about
// time: it is invoked through a Function URL in RESPONSE_STREAM mode (minutes,
// and tokens flush as they are produced) instead of API Gateway's buffered
// 29-second integration. See plans/in-progress/ai-chat-assistant.md,
// "The 29-second problem".
//
// The Function URL is public (authType NONE) — exactly like the HTTP API, which
// also has no gateway authorizer: every request is authenticated in-function by
// tenantMiddleware. To keep that public surface small, this entry serves ONLY
// the assistant prefix; any other path is a 404 here, so the Function URL can't
// be used to reach the rest of the API around API Gateway's throttle.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { streamHandle } from 'hono/aws-lambda'
import { app } from './app'
import { validateEnv } from './lib/env'

validateEnv()

export const ASSISTANT_PREFIX = '/api/v1/assistant'

export const assistantOnlyApp = new Hono()

assistantOnlyApp.all('*', (c) => {
  const path = new URL(c.req.url).pathname
  if (path !== ASSISTANT_PREFIX && !path.startsWith(`${ASSISTANT_PREFIX}/`)) {
    return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
  }
  return app.fetch(c.req.raw)
})

export const handler: ReturnType<typeof streamHandle> = streamHandle(assistantOnlyApp)
