// ---------------------------------------------------------------------------
// Executable proof of the constraint that decides where the pegII reports route
// lives (see handlers/pegii-reports.ts and dolas/agents/project/GOTCHAS.md).
//
// app.ts mounts m2mV1 and v1 on the SAME `/api/v1` prefix, and m2mV1's
// pegiiRuntimeHandler does `use('*', dualAuthMiddleware)` under `/pegii`. This
// asserts what that actually costs: a session route added under `/pegii/...`
// would run the m2m middleware even though the m2m sub-app has no handler for
// it — which is why the reports bridge is mounted at `/pegii-reports` instead.
//
// Pure Hono, no app.ts import: this is a statement about the framework's
// mounting semantics, which is the thing that could silently change under us.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'

function buildTwoRouterApp() {
  const calls: string[] = []

  const m2mSub = new Hono()
  m2mSub.use('*', async (_c, next) => {
    calls.push('m2m-middleware')
    await next()
  })
  m2mSub.get('/orders', (c) => c.text('m2m orders'))

  const m2m = new Hono()
  m2m.route('/pegii', m2mSub)

  const session = new Hono()
  session.get('/pegii/reports/:id', (c) => c.text(`session report ${c.req.param('id')}`))
  session.get('/pegii-reports/:id', (c) => c.text(`isolated report ${c.req.param('id')}`))

  const app = new Hono()
  app.route('/api/v1', m2m)
  app.route('/api/v1', session)
  return { app, calls }
}

describe('two routers on one prefix', () => {
  it('still routes a path the first sub-app does not handle to the second router', async () => {
    const { app } = buildTwoRouterApp()

    const res = await app.request('/api/v1/pegii/reports/12345')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('session report 12345')
  })

  it("runs the first sub-app's wildcard middleware on that path anyway", async () => {
    // THE TRAP. The session handler answered, but the m2m auth middleware ran
    // on the way there — nothing about the session route says so.
    const { app, calls } = buildTwoRouterApp()

    await app.request('/api/v1/pegii/reports/12345')

    expect(calls).toEqual(['m2m-middleware'])
  })

  it('does not run it for a sibling prefix — the isolation the reports route relies on', async () => {
    const { app, calls } = buildTwoRouterApp()

    const res = await app.request('/api/v1/pegii-reports/12345')

    expect(await res.text()).toBe('isolated report 12345')
    expect(calls).toEqual([])
  })
})

describe('the real app', () => {
  it('serves the reports bridge without the m2m dual-auth middleware', async () => {
    // dual-auth would 401 an unauthenticated request before the handler; the
    // route's own tenant middleware is what must reject it instead. Asserting
    // the middleware module is never invoked is the load-bearing part.
    const dualAuth = vi.fn(async (_c: unknown, next: () => Promise<void>) => {
      await next()
    })

    const reports = new Hono()
    reports.get('/:reportType/:id', (c) => c.text('report'))

    const pegiiM2m = new Hono()
    pegiiM2m.use('*', dualAuth)
    pegiiM2m.get('/orders/:id', (c) => c.text('order'))

    const m2m = new Hono()
    m2m.route('/pegii', pegiiM2m)
    const v1 = new Hono()
    v1.route('/pegii-reports', reports)

    const app = new Hono()
    app.route('/api/v1', m2m)
    app.route('/api/v1', v1)

    await app.request('/api/v1/pegii-reports/order-profile/12345')

    expect(dualAuth).not.toHaveBeenCalled()
  })
})
