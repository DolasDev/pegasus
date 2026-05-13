// ---------------------------------------------------------------------------
// Unit tests for the longhaul remote handler.
// `process.platform` is overridden per-test to exercise both branches.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import { remoteRouter } from './remote'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

function buildApp() {
  const app = new Hono<OnPremEnv>()
  app.use('*', async (c, next) => {
    c.set('correlationId', 'cid-test')
    await next()
  })
  app.route('/', remoteRouter)
  return app
}

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('POST /remote/jump-to-order', () => {
  beforeEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
  })

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
  })

  it('returns 501 NOT_IMPLEMENTED on non-Windows platforms', async () => {
    setPlatform('linux')
    const res = await buildApp().request('/remote/jump-to-order', { method: 'POST' })
    expect(res.status).toBe(501)
    const body = await json(res)
    expect(body['code']).toBe('NOT_IMPLEMENTED')
    expect(body['correlationId']).toBe('cid-test')
    expect(String(body['error'])).toMatch(/only supported on Windows/i)
  })

  it('returns 501 NOT_IMPLEMENTED on Windows (placeholder until IPC lands)', async () => {
    setPlatform('win32')
    const res = await buildApp().request('/remote/jump-to-order', { method: 'POST' })
    expect(res.status).toBe(501)
    const body = await json(res)
    expect(body['code']).toBe('NOT_IMPLEMENTED')
    expect(body['correlationId']).toBe('cid-test')
    expect(String(body['error'])).toMatch(/not yet implemented/i)
  })
})
