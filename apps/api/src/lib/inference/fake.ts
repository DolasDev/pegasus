// ---------------------------------------------------------------------------
// Scripted inference provider for tests.
//
// It is a REAL first-party `Anthropic` client whose `fetch` replays a script of
// model responses as SSE. So the assistant's actual code path — the SDK tool
// runner, its streaming, its tool dispatch — runs unmodified; only the network
// is replaced. Each scripted response is consumed by one model request, and the
// request bodies are captured so tests can assert what the model was offered.
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk'
import type { InferenceClient, InferenceProvider } from './provider'

export type ScriptedBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

export interface ScriptedResponse {
  content: ScriptedBlock[]
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens'
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export interface FakeProvider extends InferenceProvider {
  /** Parsed JSON bodies of every request the client sent, in order. */
  readonly requests: Array<Record<string, unknown>>
}

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${String(e['type'])}\ndata: ${JSON.stringify(e)}\n\n`).join('')
}

function toSse(r: ScriptedResponse, n: number, model: string): string {
  const stop =
    r.stop_reason ?? (r.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
  const usage = {
    input_tokens: r.usage?.input_tokens ?? 10,
    output_tokens: r.usage?.output_tokens ?? 5,
    cache_read_input_tokens: r.usage?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: r.usage?.cache_creation_input_tokens ?? 0,
  }
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: {
        id: `msg_fake_${n}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { ...usage, output_tokens: 0 },
      },
    },
  ]
  r.content.forEach((b, index) => {
    if (b.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: b.text },
      })
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} },
      })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) },
      })
    }
    events.push({ type: 'content_block_stop', index })
  })
  events.push({
    type: 'message_delta',
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: usage.output_tokens },
  })
  events.push({ type: 'message_stop' })
  return sse(events)
}

export function createFakeProvider(
  script: ScriptedResponse[],
  modelId = 'fake-model',
): FakeProvider {
  const requests: Array<Record<string, unknown>> = []
  let i = 0
  const fakeFetch = async (_url: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    requests.push(body)
    const next = script[i]
    i += 1
    if (!next) {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: 'script exhausted' },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(toSse(next, i, modelId), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  const client = new Anthropic({
    apiKey: 'test-key',
    fetch: fakeFetch as unknown as typeof fetch,
    maxRetries: 0,
  })
  return {
    name: 'fake',
    modelId,
    client: client as unknown as InferenceClient,
    requests,
  }
}
