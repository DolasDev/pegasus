// ---------------------------------------------------------------------------
// Unit tests for the cloud-direct trip-note handlers (create + patch).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../types'
import { registerTestErrorHandler } from '../../test-helpers'
import type * as MssqlClient from '../../lib/mssql-executor-client'

vi.mock('../../lib/longhaul-cloud-user', () => ({ resolveLonghaulUser: vi.fn() }))
vi.mock('../../lib/mssql-executor-client', async (orig) => ({
  ...(await orig<typeof MssqlClient>()),
  executeSql: vi.fn(),
}))

import { longhaulCreateTripNoteHandler, longhaulPatchTripNoteHandler } from './trip-notes'
import { resolveLonghaulUser } from '../../lib/longhaul-cloud-user'
import { executeSql } from '../../lib/mssql-executor-client'

const resolveMock = resolveLonghaulUser as unknown as Mock
const executeSqlMock = executeSql as unknown as Mock

function buildApp() {
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1')
    c.set('correlationId', 'corr-1')
    c.set('userId', 'user-1')
    await next()
  })
  app.post('/onprem/longhaul/trips/:id/notes', longhaulCreateTripNoteHandler)
  app.patch('/onprem/longhaul/notes/:id', longhaulPatchTripNoteHandler)
  return app
}

function req(path: string, method: string, body: unknown) {
  return buildApp().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveMock.mockResolvedValue({ ok: true, connectionString: 'Server=a,1433', code: 7, user: {} })
  executeSqlMock.mockResolvedValue({ recordset: [], recordsets: [[]], rowsAffected: [1] })
})

describe('POST /trips/:id/notes (cloud-direct)', () => {
  it('inserts a note stamping the resolved user code on createdBy', async () => {
    const res = await req('/onprem/longhaul/trips/55/notes', 'POST', { note: 'hello' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ data: { success: true } })
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('INSERT INTO TripNotes')
    expect(opts.params).toContainEqual({ name: 'tripId', value: 55 })
    expect(opts.params).toContainEqual({ name: 'note', value: 'hello' })
    expect(opts.params).toContainEqual({ name: 'createdBy', value: 7 })
    expect(opts.params).toContainEqual({ name: 'type', value: 'DISPATCH' })
  })

  it('honors an explicit note type', async () => {
    await req('/onprem/longhaul/trips/55/notes', 'POST', { note: 'x', type: 'OPS' })
    const [, , opts] = executeSqlMock.mock.calls[0]!
    expect(opts.params).toContainEqual({ name: 'type', value: 'OPS' })
  })

  it('defaults createdBy to 0 when no legacy code is resolved (M2M)', async () => {
    resolveMock.mockResolvedValue({
      ok: true,
      connectionString: 'Server=a,1433',
      code: null,
      user: null,
    })
    await req('/onprem/longhaul/trips/55/notes', 'POST', { note: 'x' })
    const [, , opts] = executeSqlMock.mock.calls[0]!
    expect(opts.params).toContainEqual({ name: 'createdBy', value: 0 })
  })

  it('rejects an empty note with 400', async () => {
    const res = await req('/onprem/longhaul/trips/55/notes', 'POST', { note: '' })
    expect(res.status).toBe(400)
    expect(executeSqlMock).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric trip id with 400', async () => {
    const res = await req('/onprem/longhaul/trips/x/notes', 'POST', { note: 'x' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /notes/:id (cloud-direct)', () => {
  it('updates the note scoped by tripId AND id', async () => {
    const res = await req('/onprem/longhaul/notes/9', 'PATCH', { note: 'edited', tripId: 55 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { success: true } })
    const [, sql, opts] = executeSqlMock.mock.calls[0]!
    expect(sql).toContain('UPDATE TripNotes SET note = @note')
    expect(sql).toContain('WHERE tripId = @tripId AND id = @id')
    expect(opts.params).toContainEqual({ name: 'note', value: 'edited' })
    expect(opts.params).toContainEqual({ name: 'tripId', value: 55 })
    expect(opts.params).toContainEqual({ name: 'id', value: 9 })
  })

  it('defaults tripId to 0 when omitted', async () => {
    await req('/onprem/longhaul/notes/9', 'PATCH', { note: 'edited' })
    const [, , opts] = executeSqlMock.mock.calls[0]!
    expect(opts.params).toContainEqual({ name: 'tripId', value: 0 })
  })

  it('returns 500 when the executor write fails', async () => {
    executeSqlMock.mockRejectedValue(new Error('boom'))
    const res = await req('/onprem/longhaul/notes/9', 'PATCH', { note: 'edited', tripId: 55 })
    expect(res.status).toBe(500)
  })
})
