// ---------------------------------------------------------------------------
// Scripted inference provider for tests, at the neutral round seam (plan D9).
//
// Each scripted response answers one model round: its text is streamed as
// deltas, then the round ends with the scripted content, stop reason and
// usage. The loop above the seam (assistant/loop.ts) runs unmodified. Every
// RoundRequest is captured so tests can assert what the model was offered.
//
// What this does NOT exercise is an adapter's own translation to a provider
// API. converse.test.ts and anthropic.test.ts cover that.
// ---------------------------------------------------------------------------

import type { ContentPart, InferenceProvider, RoundRequest } from './types'

export type ScriptedBlock =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
      inputError?: string
    }
  | { type: 'reasoning'; raw: unknown }

export interface ScriptedResponse {
  content: ScriptedBlock[]
  stop_reason?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export interface FakeProvider extends InferenceProvider {
  /** A snapshot of every round request, in order. */
  readonly requests: RoundRequest[]
}

export function createFakeProvider(
  script: ScriptedResponse[],
  modelId = 'fake-model',
): FakeProvider {
  const requests: RoundRequest[] = []
  let i = 0
  return {
    name: 'fake',
    modelId,
    requests,
    async *streamRound(request) {
      requests.push(structuredClone(request))
      const next = script[i]
      i += 1
      if (!next) throw new Error('script exhausted')
      for (const b of next.content) {
        if (b.type === 'text') yield { type: 'text_delta', text: b.text }
      }
      const stop =
        next.stop_reason ??
        (next.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
      yield {
        type: 'round_end',
        content: next.content as ContentPart[],
        stopReason: stop,
        usage: {
          inputTokens: next.usage?.input_tokens ?? 10,
          outputTokens: next.usage?.output_tokens ?? 5,
          cacheReadTokens: next.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: next.usage?.cache_creation_input_tokens ?? 0,
        },
      }
    },
  }
}
