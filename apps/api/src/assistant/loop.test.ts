// The agent loop against a scripted provider: the REAL SDK tool runner and its
// streaming run unmodified; only the network is replaced (lib/inference/fake.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _clearAuthzCache } from '../lib/authz'
import { createFakeProvider } from '../lib/inference/fake'
import { runTurn, historyFromTurns, type AssistantEvent } from './loop'
import { DEFAULT_PROMPT } from './prompt'
import type { ToolContext } from './tools/types'

function toolCtx(roleNames: string[], fetchApi: ToolContext['fetchApi']): ToolContext {
  return {
    principal: { sub: 's', tenantId: 't', roleNames },
    idToken: 'tok',
    policyStoreId: undefined,
    fetchApi,
  }
}

const NOW = new Date('2026-11-10T15:00:00Z')

beforeEach(() => {
  _clearAuthzCache()
  process.env['AUTHZ_OFFLINE'] = 'true'
})

describe('runTurn', () => {
  it('runs a tool round then answers, streaming text and tracing the call', async () => {
    const provider = createFakeProvider([
      {
        content: [
          { type: 'text', text: 'Looking up drivers. ' },
          { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: { name: 'smi' } },
        ],
        usage: { input_tokens: 1200, output_tokens: 40, cache_creation_input_tokens: 1000 },
      },
      {
        content: [{ type: 'text', text: 'Jo Smith is driver 7.' }],
        usage: { input_tokens: 1300, output_tokens: 12, cache_read_input_tokens: 1000 },
      },
    ])
    const fetchApi = vi.fn(async (_path: string) =>
      Response.json({
        data: [
          { driver_id: 7, driver_name: 'Jo Smith' },
          { driver_id: 8, driver_name: 'Al Jones' },
        ],
      }),
    )
    const events: AssistantEvent[] = []

    const result = await runTurn({
      provider,
      tool: toolCtx(['operations_admin'], fetchApi),
      prompt: DEFAULT_PROMPT,
      history: [],
      question: 'Who is Smith?',
      now: NOW,
      onEvent: (e) => events.push(e),
    })

    expect(result.error).toBeNull()
    expect(result.text).toBe('Jo Smith is driver 7.')
    expect(result.rounds).toBe(2)
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({
      inputTokens: 2500,
      outputTokens: 52,
      cacheReadTokens: 1000,
      cacheWriteTokens: 1000,
    })

    // The tool ran in-process against the endpoint, filtered to the name.
    expect(fetchApi).toHaveBeenCalledWith('/api/v1/onprem/longhaul/drivers')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]).toMatchObject({
      toolUseId: 'tu_1',
      toolName: 'list_drivers',
      allowed: true,
      resultCount: 1,
    })

    // Text streamed from both rounds; tool activity surfaced.
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)
    expect(text.join('')).toBe('Looking up drivers. Jo Smith is driver 7.')
    expect(events.some((e) => e.type === 'tool_start')).toBe(true)
    expect(events.find((e) => e.type === 'tool_end')).toMatchObject({
      allowed: true,
      isError: false,
    })
  })

  it('offers only permitted tools, in name order, with the cache breakpoint after the system prompt', async () => {
    const provider = createFakeProvider([{ content: [{ type: 'text', text: 'ok' }] }])
    await runTurn({
      provider,
      tool: toolCtx(['operations_admin'], vi.fn()),
      prompt: DEFAULT_PROMPT,
      history: [],
      question: 'hi',
      now: NOW,
    })
    const req = provider.requests[0]!
    expect((req['tools'] as Array<{ name: string }>).map((t) => t.name)).toEqual([
      'get_trip',
      'list_drivers',
      'search_shipments',
      'search_trips',
    ])
    const system = req['system'] as Array<{ text: string; cache_control?: unknown }>
    expect(system.at(-1)?.cache_control).toEqual({ type: 'ephemeral' })
    expect(system.map((s) => s.text).join('')).not.toContain('2026')
    expect(req['output_config']).toEqual({ effort: 'medium' })
    // Today's date rides on the user message instead.
    const messages = req['messages'] as Array<{ content: Array<{ text: string }> }>
    expect(messages.at(-1)?.content[0]?.text).toContain('2026-11-10')
  })

  it('sends the same system prefix on every round (no cache invalidator)', async () => {
    const provider = createFakeProvider([
      { content: [{ type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} }] },
      { content: [{ type: 'text', text: 'done' }] },
    ])
    await runTurn({
      provider,
      tool: toolCtx(
        ['operations_admin'],
        vi.fn(async () => Response.json({ data: [] })),
      ),
      prompt: DEFAULT_PROMPT,
      history: [],
      question: 'hi',
      now: NOW,
    })
    expect(provider.requests).toHaveLength(2)
    // No server-held thread: Bedrock has none, so each round must be complete.
    for (const r of provider.requests) expect(r).not.toHaveProperty('thread')
    expect(provider.requests[1]!['messages']).toHaveLength(3)
    expect(JSON.stringify(provider.requests[1]!['system'])).toBe(
      JSON.stringify(provider.requests[0]!['system']),
    )
    expect(JSON.stringify(provider.requests[1]!['tools'])).toBe(
      JSON.stringify(provider.requests[0]!['tools']),
    )
  })

  it('reports a tool error to the model as an error result and keeps going', async () => {
    const provider = createFakeProvider([
      { content: [{ type: 'tool_use', id: 'tu_1', name: 'get_trip', input: { trip_id: 9 } }] },
      { content: [{ type: 'text', text: 'I could not find trip 9.' }] },
    ])
    const fetchApi = vi.fn(async () => Response.json({ code: 'NOT_FOUND' }, { status: 404 }))
    const result = await runTurn({
      provider,
      tool: toolCtx(['tenant_admin'], fetchApi),
      prompt: DEFAULT_PROMPT,
      history: [],
      question: 'trip 9?',
      now: NOW,
    })
    const second = provider.requests[1]!['messages'] as Array<{ role: string; content: unknown }>
    const toolResult = (second.at(-1)?.content as Array<Record<string, unknown>>)[0]!
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true })
    expect(result.toolCalls[0]).toMatchObject({
      allowed: true,
      error: 'Not found (or not visible to this user).',
    })
    expect(result.text).toBe('I could not find trip 9.')
  })

  it('returns the error instead of throwing when the provider fails', async () => {
    const provider = createFakeProvider([])
    const result = await runTurn({
      provider,
      tool: toolCtx(['tenant_admin'], vi.fn()),
      prompt: DEFAULT_PROMPT,
      history: [],
      question: 'hi',
      now: NOW,
    })
    expect(result.error).toMatch(/script exhausted|500/)
    expect(result.text).toBe('')
  })
})

describe('historyFromTurns', () => {
  it('keeps user/assistant turns with content, in order', () => {
    expect(
      historyFromTurns([
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        { role: 'assistant', content: [] },
      ]),
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
    ])
  })
})
