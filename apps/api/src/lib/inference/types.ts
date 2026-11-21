// ---------------------------------------------------------------------------
// The provider-neutral inference seam: ONE model round.
//
// A round is one request to the model and its streamed reply. The tool loop
// (assistant/loop.ts) is ours and runs on top of this seam. A provider adapter
// therefore only translates a round to and from its own API:
// Bedrock Converse (converse.ts), or Anthropic Messages on the Bedrock invoke
// path (anthropic.ts). Swapping models becomes configuration, not a rewrite.
// Plan: plans/*/assistant-converse.md (D1).
// ---------------------------------------------------------------------------

export type Effort = 'low' | 'medium' | 'high'

/**
 * Reasoning ("thinking") the model produced. It is NOT portable: each adapter
 * emits it in its own shape (`raw`) and must get it back unchanged on the next
 * round of the same turn, because providers verify the signature. It is never
 * persisted and never crosses turns.
 */
export interface ReasoningPart {
  readonly type: 'reasoning'
  readonly raw: unknown
}

export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_use'
      readonly id: string
      readonly name: string
      readonly input: unknown
      /** Set when the model's input JSON could not be parsed; `input` is then `{}`. */
      readonly inputError?: string
    }
  | {
      readonly type: 'tool_result'
      readonly toolUseId: string
      readonly content: string
      readonly isError: boolean
    }
  | ReasoningPart

export interface ChatMessage {
  readonly role: 'user' | 'assistant'
  readonly content: readonly ContentPart[]
}

export interface ToolSpec {
  readonly name: string
  readonly description: string
  /** JSON Schema of the tool's input (an object schema). */
  readonly inputSchema: Record<string, unknown>
}

export interface RoundRequest {
  /** System prompt blocks, in order. The cache point (if any) goes after the last. */
  readonly system: readonly string[]
  readonly tools: readonly ToolSpec[]
  readonly messages: readonly ChatMessage[]
  readonly maxTokens: number
  readonly effort: Effort
  /** Ask for a prompt-cache point after tools + system, where the model allows one. */
  readonly cache: boolean
}

export interface RoundUsage {
  /** Uncached input tokens only, on both APIs. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type RoundEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | {
      readonly type: 'round_end'
      /** The complete assistant message, in the order the model produced it. */
      readonly content: readonly ContentPart[]
      /** The provider's stop reason, verbatim (`end_turn`, `tool_use`, `max_tokens`, …). */
      readonly stopReason: string | null
      readonly usage: RoundUsage
    }

export interface InferenceProvider {
  /** `bedrock-converse`, `bedrock-anthropic`, or `fake`. */
  readonly name: string
  /** The model id sent on every request (a Bedrock inference profile id). */
  readonly modelId: string
  /** One model round. It ends with exactly one `round_end`, or throws. */
  streamRound(request: RoundRequest, signal?: AbortSignal): AsyncIterable<RoundEvent>
}
