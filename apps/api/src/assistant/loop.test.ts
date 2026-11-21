// The agent loop against a scripted provider at the neutral round seam
// (lib/inference/fake.ts). The loop, tool dispatch, gates and tracing run
// unmodified; each adapter's translation to its provider API is covered by
// lib/inference/{converse,anthropic}.test.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _clearAuthzCache } from '../lib/authz'
import { createFakeProvider } from '../lib/inference/fake'
import type { ContentPart } from '../lib/inference/types'
import { runTurn, historyFromTurns, type AssistantEvent } from './loop'
import { BASE_INSTRUCTIONS, DEFAULT_PROMPT } from './prompt'
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
const emptyList = () => vi.fn(async (_path: string) => Response.json({ data: [] }))

function base(provider: ReturnType<typeof createFakeProvider>, fetchApi = emptyList()) {
  return {
    provider,
    tool: toolCtx(['operations_admin'], fetchApi),
    prompt: DEFAULT_PROMPT,
    history: [],
    question: 'hi',
    now: NOW,
  }
}

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
      ...base(provider, fetchApi),
      question: 'Who is Smith?',
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

  it('offers only permitted tools, in name order, asks for the cache after the system prompt, and sends effort', async () => {
    const provider = createFakeProvider([{ content: [{ type: 'text', text: 'ok' }] }])
    await runTurn(base(provider, vi.fn()))
    const req = provider.requests[0]!
    expect(req.tools.map((t) => t.name)).toEqual([
      'get_trip',
      'list_drivers',
      'search_shipments',
      'search_trips',
    ])
    expect(req.tools[0]!.inputSchema).toMatchObject({ type: 'object' })
    expect(req.system[0]).toBe(BASE_INSTRUCTIONS)
    expect(req.cache).toBe(true)
    expect(req.system.join('')).not.toContain('2026')
    expect(req.effort).toBe('medium')
    // Today's date rides on the user message instead.
    const last = req.messages.at(-1)!.content[0] as { text: string }
    expect(last.text).toContain('2026-11-10')
  })

  it('sends a complete request with the same system prefix on every round', async () => {
    const provider = createFakeProvider([
      { content: [{ type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} }] },
      { content: [{ type: 'text', text: 'done' }] },
    ])
    await runTurn({ ...base(provider), effort: 'low' })
    expect(provider.requests).toHaveLength(2)
    const [r1, r2] = provider.requests
    // No server-held state: round 2 carries question, tool call and result.
    expect(r2!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(r2!.messages[2]!.content[0]).toMatchObject({ type: 'tool_result', toolUseId: 'tu_1' })
    expect(JSON.stringify(r2!.system)).toBe(JSON.stringify(r1!.system))
    expect(JSON.stringify(r2!.tools)).toBe(JSON.stringify(r1!.tools))
    expect(r2!.effort).toBe('low')
  })

  it('reports a tool error to the model as an error result and keeps going', async () => {
    const provider = createFakeProvider([
      { content: [{ type: 'tool_use', id: 'tu_1', name: 'get_trip', input: { trip_id: 9 } }] },
      { content: [{ type: 'text', text: 'I could not find trip 9.' }] },
    ])
    const fetchApi = vi.fn(async () => Response.json({ code: 'NOT_FOUND' }, { status: 404 }))
    const result = await runTurn({
      ...base(provider),
      tool: toolCtx(['tenant_admin'], fetchApi),
      question: 'trip 9?',
    })
    const toolResult = provider.requests[1]!.messages.at(-1)!.content[0]
    expect(toolResult).toEqual({
      type: 'tool_result',
      toolUseId: 'tu_1',
      content: 'Not found (or not visible to this user).',
      isError: true,
    })
    expect(result.toolCalls[0]).toMatchObject({
      allowed: true,
      error: 'Not found (or not visible to this user).',
    })
    expect(result.text).toBe('I could not find trip 9.')
  })

  it('answers malformed tool input and unknown tools with error results, without running anything', async () => {
    const provider = createFakeProvider([
      {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'list_drivers',
            input: {},
            inputError: 'The tool input was not valid JSON.',
          },
          { type: 'tool_use', id: 'tu_2', name: 'delete_everything', input: {} },
        ],
      },
      { content: [{ type: 'text', text: 'sorry' }] },
    ])
    const fetchApi = emptyList()
    const result = await runTurn(base(provider, fetchApi))
    expect(fetchApi).not.toHaveBeenCalled()
    expect(provider.requests[1]!.messages.at(-1)!.content).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'tu_1',
        content: 'The tool input was not valid JSON.',
        isError: true,
      },
      {
        type: 'tool_result',
        toolUseId: 'tu_2',
        content: 'There is no tool named delete_everything.',
        isError: true,
      },
    ])
    expect(result.toolCalls.map((c) => [c.toolUseId, c.allowed])).toEqual([
      ['tu_1', true],
      ['tu_2', false],
    ])
  })

  it('runs one round’s tool calls in parallel and returns results in the model’s order', async () => {
    const provider = createFakeProvider([
      {
        content: [
          { type: 'tool_use', id: 'slow', name: 'list_drivers', input: { name: 'smi' } },
          { type: 'tool_use', id: 'fast', name: 'list_drivers', input: { name: 'jon' } },
        ],
      },
      { content: [{ type: 'text', text: 'done' }] },
    ])
    let inFlight = 0
    let maxInFlight = 0
    const fetchApi = vi.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight -= 1
      return Response.json({ data: [] })
    })
    const result = await runTurn(base(provider, fetchApi))
    expect(maxInFlight).toBe(2)
    const ids = provider.requests[1]!.messages.at(-1)!.content.map(
      (p) => (p as { toolUseId: string }).toolUseId,
    )
    expect(ids).toEqual(['slow', 'fast'])
    expect(result.toolCalls).toHaveLength(2)
  })

  it('echoes reasoning back unchanged on the next round of the same turn', async () => {
    const reasoning = { reasoningContent: { reasoningText: { text: 'think', signature: 'sig' } } }
    const provider = createFakeProvider([
      {
        content: [
          { type: 'reasoning', raw: reasoning },
          { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} },
        ],
      },
      { content: [{ type: 'text', text: 'done' }] },
    ])
    await runTurn(base(provider))
    const assistant = provider.requests[1]!.messages[1]!
    expect(assistant.role).toBe('assistant')
    expect(assistant.content[0]).toEqual({ type: 'reasoning', raw: reasoning })
  })

  it('stops at the round limit without running the last round’s tools', async () => {
    const use = (id: string) => ({
      content: [{ type: 'tool_use' as const, id, name: 'list_drivers', input: {} }],
    })
    const provider = createFakeProvider([use('a'), use('b'), use('c')])
    const fetchApi = emptyList()
    const result = await runTurn({ ...base(provider, fetchApi), maxRounds: 2 })
    expect(provider.requests).toHaveLength(2)
    expect(fetchApi).toHaveBeenCalledTimes(1)
    expect(result.rounds).toBe(2)
    expect(result.stopReason).toBe('tool_use')
    expect(result.error).toBeNull()
  })

  it('stops on max_tokens even when the cut-off message holds a tool call', async () => {
    const provider = createFakeProvider([
      {
        content: [
          { type: 'text', text: 'partial' },
          { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} },
        ],
        stop_reason: 'max_tokens',
      },
    ])
    const fetchApi = emptyList()
    const result = await runTurn(base(provider, fetchApi))
    expect(fetchApi).not.toHaveBeenCalled()
    expect(result.stopReason).toBe('max_tokens')
    expect(result.text).toBe('partial')
  })

  it('returns the error instead of throwing when the provider fails', async () => {
    const result = await runTurn(base(createFakeProvider([])))
    expect(result.error).toBe('script exhausted')
    expect(result.text).toBe('')
  })

  it('returns an abort as an error and sends nothing', async () => {
    const provider = createFakeProvider([{ content: [{ type: 'text', text: 'x' }] }])
    const ac = new AbortController()
    ac.abort()
    const result = await runTurn({ ...base(provider), signal: ac.signal })
    expect(provider.requests).toHaveLength(0)
    expect(result.error).toBeTruthy()
  })
})

describe('historyFromTurns', () => {
  const t = (role: string, text?: string) => ({
    role,
    content: text === undefined ? [] : [{ type: 'text', text }],
  })
  const text = (s: string): ContentPart => ({ type: 'text', text: s })

  it('keeps user/assistant turns with text content, in order', () => {
    expect(historyFromTurns([t('user', 'q'), t('assistant', 'a'), t('assistant')])).toEqual([
      { role: 'user', content: [text('q')] },
      { role: 'assistant', content: [text('a')] },
    ])
  })

  it('keeps strict alternation for Converse: merges runs, drops a leading answer and a trailing unanswered question', () => {
    expect(
      historyFromTurns([
        t('assistant', 'orphan'),
        t('user', 'q1'),
        t('assistant'), // a failed answer: nothing stored
        t('user', 'q2'),
        t('assistant', 'a2'),
        t('user', 'q3'),
        t('assistant'),
      ]),
    ).toEqual([
      { role: 'user', content: [text('q1'), text('q2')] },
      { role: 'assistant', content: [text('a2')] },
    ])
  })

  it('ignores non-text and malformed blocks', () => {
    expect(
      historyFromTurns([
        { role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'q' }, null] },
        { role: 'assistant', content: 'not an array' },
      ]),
    ).toEqual([])
  })
})
