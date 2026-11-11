/**
 * Integration tests for /api/v1/assistant — the real router against Postgres
 * through `createTenantDb` (the scoped client tenantMiddleware installs), Cedar
 * evaluated offline, and the scripted inference provider. Tools reach a tiny
 * in-process fake API, standing in for app.fetch.
 *
 * Requires a live PostgreSQL database. Skipped automatically when DATABASE_URL
 * is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { db } from '../db'
import { createTenantDb } from '../lib/prisma'
import { _clearAuthzCache } from '../lib/authz'
import { createFakeProvider, type ScriptedResponse } from '../lib/inference/fake'
import { setInferenceProviderForTests } from '../lib/inference/provider'
import { createAssistantRouter } from './http'

const hasDb = Boolean(process.env['DATABASE_URL'])
const SLUG_A = 'test-assistant-a'
const SLUG_B = 'test-assistant-b'
let tenantA = ''
let tenantB = ''

/** The API the tools call in-process. Records what it was asked. */
const apiCalls: string[] = []
const fakeApi = new Hono()
fakeApi.get('/api/v1/onprem/longhaul/drivers', (c) => {
  apiCalls.push(`${c.req.path} auth=${c.req.header('authorization') ?? ''}`)
  return c.json({ data: [{ driver_id: 7, driver_name: 'Jo Smith' }] })
})

function app(opts: { tenantId: string; roleNames: string[]; userId?: string }) {
  const a = new Hono<AppEnv>()
  a.use('*', async (c, next) => {
    c.set('correlationId', 'cid-test')
    c.set('tenantId', opts.tenantId)
    c.set('principal', { sub: 'sub-1', tenantId: opts.tenantId, roleNames: opts.roleNames })
    c.set('idToken', undefined)
    c.set('policyStoreId', undefined)
    if (opts.userId !== undefined) c.set('userId', opts.userId)
    c.set('db', createTenantDb(db, opts.tenantId) as unknown as PrismaClient)
    await next()
  })
  a.route(
    '/api/v1/assistant',
    createAssistantRouter((req) => fakeApi.fetch(req)),
  )
  return a
}

const opsAdmin = () => app({ tenantId: tenantA, roleNames: ['operations_admin'], userId: 'user-a' })

function post(a: Hono<AppEnv>, path: string, body: unknown) {
  return a.request(`/api/v1/assistant${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer caller-token' },
    body: JSON.stringify(body),
  })
}

/** Parse an SSE body into [event, data] pairs. */
async function events(res: Response): Promise<Array<[string, Record<string, unknown>]>> {
  const text = await res.text()
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const ev = /^event: (.*)$/m.exec(block)?.[1] ?? ''
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? '{}'
      return [ev, JSON.parse(data) as Record<string, unknown>]
    })
}

function useScript(script: ScriptedResponse[]) {
  const p = createFakeProvider(script)
  setInferenceProviderForTests(p)
  return p
}

async function wipe(tenantId: string) {
  await db.assistantConversation.deleteMany({ where: { tenantId } })
  await db.assistantPromptVersion.deleteMany({ where: { tenantId } })
}

describe.skipIf(!hasDb)('/assistant (integration)', () => {
  beforeAll(async () => {
    process.env['AUTHZ_OFFLINE'] = 'true'
    const upsert = (slug: string) =>
      db.tenant.upsert({ where: { slug }, create: { name: slug, slug }, update: {} })
    tenantA = (await upsert(SLUG_A)).id
    tenantB = (await upsert(SLUG_B)).id
  })

  beforeEach(async () => {
    _clearAuthzCache()
    process.env['ASSISTANT_ENABLED'] = 'true'
    apiCalls.length = 0
    await wipe(tenantA)
    await wipe(tenantB)
  })

  afterEach(() => setInferenceProviderForTests(null))

  afterAll(async () => {
    delete process.env['ASSISTANT_ENABLED']
    for (const t of [tenantA, tenantB].filter(Boolean)) await wipe(t).catch(() => undefined)
    await db.$disconnect()
  })

  it('is off (404) unless ASSISTANT_ENABLED=true — the CDK-wired kill switch', async () => {
    delete process.env['ASSISTANT_ENABLED']
    const res = await opsAdmin().request('/api/v1/assistant/tools')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('ASSISTANT_DISABLED')
  })

  it('answers 503 when the model cannot be loaded, before writing a conversation', async () => {
    // No test provider + a refused (global.*) model id: resolution throws, as a
    // failed lazy SDK load would in a Lambda.
    process.env['ASSISTANT_MODEL_ID'] = 'global.anthropic.claude-opus-5'
    try {
      const res = await post(opsAdmin(), '/chat', { question: 'hi' })
      expect(res.status).toBe(503)
      expect(((await res.json()) as { code: string }).code).toBe('ASSISTANT_UNAVAILABLE')
      expect(await db.assistantConversation.count({ where: { tenantId: tenantA } })).toBe(0)
    } finally {
      delete process.env['ASSISTANT_MODEL_ID']
    }
  })

  it('denies personas without UseAssistant', async () => {
    const res = await app({ tenantId: tenantA, roleNames: ['viewer'], userId: 'u' }).request(
      '/api/v1/assistant/tools',
    )
    expect(res.status).toBe(403)
  })

  it('lists the tools this user would be offered', async () => {
    const res = await opsAdmin().request('/api/v1/assistant/tools')
    const body = (await res.json()) as { data: Array<{ name: string }> }
    expect(body.data.map((t) => t.name)).toEqual([
      'get_trip',
      'list_drivers',
      'search_shipments',
      'search_trips',
    ])
  })

  it('streams an answer, runs the tool AS THE CALLER, and persists the trace', async () => {
    useScript([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: { name: 'smith' } }],
      },
      { content: [{ type: 'text', text: 'Jo Smith is driver 7.' }], usage: { input_tokens: 50 } },
    ])
    const res = await post(opsAdmin(), '/chat', { question: 'who is smith?' })
    expect(res.status).toBe(200)
    const evs = await events(res)
    const names = evs.map(([e]) => e)
    expect(names[0]).toBe('conversation')
    expect(names).toContain('tool_start')
    expect(names).toContain('text')
    expect(names.at(-1)).toBe('done')

    // The in-process call carried the caller's own bearer token.
    expect(apiCalls).toEqual(['/api/v1/onprem/longhaul/drivers auth=Bearer caller-token'])

    const done = evs.at(-1)![1] as { conversationId: string; text: string }
    expect(done.text).toBe('Jo Smith is driver 7.')
    const conv = await opsAdmin().request(`/api/v1/assistant/conversations/${done.conversationId}`)
    const detail = (await conv.json()) as {
      data: {
        turns: Array<{
          role: string
          inputTokens: number
          toolCalls: Array<Record<string, unknown>>
        }>
      }
    }
    expect(detail.data.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(detail.data.turns[1]!.toolCalls[0]).toMatchObject({
      toolName: 'list_drivers',
      allowed: true,
      resultCount: 1,
    })
  })

  it('continues a conversation with its history and keeps it private to its owner', async () => {
    useScript([{ content: [{ type: 'text', text: 'first' }] }])
    const first = await events(await post(opsAdmin(), '/chat', { question: 'q1' }))
    const conversationId = (first.at(-1)![1] as { conversationId: string }).conversationId

    const p = useScript([{ content: [{ type: 'text', text: 'second' }] }])
    await events(await post(opsAdmin(), '/chat', { question: 'q2', conversationId }))
    const sent = p.requests[0]!['messages'] as Array<{ role: string }>
    expect(sent.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])

    // Another user in the same tenant cannot read or continue it…
    const other = app({ tenantId: tenantA, roleNames: ['operations_admin'], userId: 'user-b' })
    expect((await other.request(`/api/v1/assistant/conversations/${conversationId}`)).status).toBe(
      404,
    )
    expect((await post(other, '/chat', { question: 'x', conversationId })).status).toBe(404)
    // …and neither can the same user id in another tenant.
    const otherTenant = app({
      tenantId: tenantB,
      roleNames: ['operations_admin'],
      userId: 'user-a',
    })
    expect(
      (await otherTenant.request(`/api/v1/assistant/conversations/${conversationId}`)).status,
    ).toBe(404)
  })

  it('versions, publishes and rolls back prompts; chat uses the published one', async () => {
    const a = opsAdmin()
    const v1 = (await (await post(a, '/prompts', { systemPrompt: 'PROMPT ONE' })).json()) as {
      data: { id: string; version: number; status: string }
    }
    const v2 = (await (await post(a, '/prompts', { systemPrompt: 'PROMPT TWO' })).json()) as {
      data: { id: string; version: number }
    }
    expect([v1.data.version, v2.data.version, v1.data.status]).toEqual([1, 2, 'DRAFT'])

    await post(a, `/prompts/${v2.data.id}/publish`, {})
    let p = useScript([{ content: [{ type: 'text', text: 'ok' }] }])
    await events(await post(a, '/chat', { question: 'hi' }))
    expect(JSON.stringify(p.requests[0]!['system'])).toContain('PROMPT TWO')

    // Rollback = publish the older version; the newer one is superseded.
    await post(a, `/prompts/${v1.data.id}/publish`, {})
    const list = (await (await a.request('/api/v1/assistant/prompts')).json()) as {
      data: Array<{ version: number; status: string }>
    }
    expect(list.data.map((v) => [v.version, v.status])).toEqual([
      [2, 'SUPERSEDED'],
      [1, 'PUBLISHED'],
    ])
    p = useScript([{ content: [{ type: 'text', text: 'ok' }] }])
    await events(await post(a, '/chat', { question: 'hi' }))
    expect(JSON.stringify(p.requests[0]!['system'])).toContain('PROMPT ONE')

    // A draft can be run from the Lab without publishing it.
    const v3 = (await (await post(a, '/prompts', { systemPrompt: 'DRAFT THREE' })).json()) as {
      data: { id: string }
    }
    p = useScript([{ content: [{ type: 'text', text: 'ok' }] }])
    await events(await post(a, '/chat', { question: 'hi', promptVersionId: v3.data.id }))
    expect(JSON.stringify(p.requests[0]!['system'])).toContain('DRAFT THREE')
  })

  it("can't publish another tenant's prompt version", async () => {
    const v = (await (await post(opsAdmin(), '/prompts', { systemPrompt: 'A' })).json()) as {
      data: { id: string }
    }
    const b = app({ tenantId: tenantB, roleNames: ['tenant_admin'], userId: 'user-x' })
    expect((await post(b, `/prompts/${v.data.id}/publish`, {})).status).toBe(404)
  })

  it('streams an eval run case by case and ends with a summary', async () => {
    useScript([{ content: [{ type: 'text', text: "I don't have access to billing." }] }])
    const res = await post(opsAdmin(), '/evals/run', {
      caseIds: ['example-driver-asks-for-an-invoice-total'],
    })
    const evs = await events(res)
    expect(evs.map(([e]) => e)).toEqual(['start', 'case', 'summary'])
    expect(evs[1]![1]).toMatchObject({
      id: 'example-driver-asks-for-an-invoice-total',
      verdict: 'pass',
    })
    expect(evs[2]![1]).toMatchObject({ summary: { total: 1, graded: 1, passed: 1 } })
  })
})
