// The Anthropic Messages adapter's translation (plan D2), driven through a
// REAL first-party Anthropic client whose fetch replays one scripted SSE
// response. Request bodies are captured so the wire shape can be asserted.
// Delete with the adapter (plan step 15).

import Anthropic from '@anthropic-ai/sdk'
import { describe, it, expect } from 'vitest'
import { anthropicProvider, buildMessagesParams, type AnthropicStreamClient } from './anthropic'
import type { RoundEvent, RoundRequest } from './types'

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${String(e['type'])}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function scriptedClient(events: Array<Record<string, unknown>>) {
  const bodies: Array<Record<string, unknown>> = []
  const fetch = async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    )
    return new Response(sse(events), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  const client = new Anthropic({
    apiKey: 'test-key',
    fetch: fetch as unknown as typeof globalThis.fetch,
    maxRetries: 0,
  })
  return { client: client as unknown as AnthropicStreamClient, bodies }
}

const REQUEST: RoundRequest = {
  system: ['base rules', 'ops prompt'],
  tools: [{ name: 'list_drivers', description: 'List drivers', inputSchema: { type: 'object' } }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'q' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', raw: { type: 'thinking', thinking: 't', signature: 's' } },
        { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'tu_1', content: 'x', isError: true }],
    },
  ],
  maxTokens: 4096,
  effort: 'medium',
  cache: true,
}

describe('buildMessagesParams', () => {
  it('puts the cache breakpoint on the last system block and maps every part', () => {
    expect(buildMessagesParams('us.anthropic.claude-opus-5', REQUEST)).toEqual({
      model: 'us.anthropic.claude-opus-5',
      max_tokens: 4096,
      system: [
        { type: 'text', text: 'base rules' },
        { type: 'text', text: 'ops prompt', cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'q' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 't', signature: 's' },
            { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'x', is_error: true }],
        },
      ],
      tools: [
        { name: 'list_drivers', description: 'List drivers', input_schema: { type: 'object' } },
      ],
      output_config: { effort: 'medium' },
    })
  })
})

describe('anthropicProvider', () => {
  it('streams text and ends the round with thinking, tool use, stop reason and usage', async () => {
    const { client, bodies } = scriptedClient([
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'm',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 40,
            output_tokens: 0,
            cache_read_input_tokens: 1000,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking.' } },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"name":"smi"}' },
      },
      { type: 'content_block_stop', index: 2 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 30 },
      },
      { type: 'message_stop' },
    ])
    const events: RoundEvent[] = []
    for await (const e of anthropicProvider('us.anthropic.claude-opus-5', client).streamRound(
      REQUEST,
    )) {
      events.push(e)
    }
    expect(events[0]).toEqual({ type: 'text_delta', text: 'Checking.' })
    expect(events[1]).toEqual({
      type: 'round_end',
      content: [
        { type: 'reasoning', raw: { type: 'thinking', thinking: 'hmm', signature: 'sig' } },
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'tu_1', name: 'list_drivers', input: { name: 'smi' } },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 40, outputTokens: 30, cacheReadTokens: 1000, cacheWriteTokens: 0 },
    })
    // A plain Messages request: no server-held thread on the Bedrock invoke path.
    expect(bodies[0]).not.toHaveProperty('thread')
    expect(bodies[0]!['output_config']).toEqual({ effort: 'medium' })
  })
})
