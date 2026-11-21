// ---------------------------------------------------------------------------
// Anthropic Messages adapter on the Bedrock InvokeModel path: one model round
// over `beta.messages.stream` (plan D2).
//
// This is Phase 1's original path, kept for ONE release behind
// ASSISTANT_INFERENCE_API=anthropic so the eval set can run both ways on the
// same cases. Delete it, and both @anthropic-ai/* dependencies, once Converse
// matches (plan step 15).
//
// It uses the DEFAULT `AnthropicBedrock` client, which calls
// /model/{id}/invoke-with-response-stream. The Service Authorization Reference
// maps that to `bedrock:InvokeModelWithResponseStream`, the pinned grant. Do
// NOT use the `mantle-client` export or the `/anthropic` Messages path: neither
// is in that reference.
//
// The SDK is loaded LAZILY: it requires @aws-sdk/client-bedrock-runtime at
// module load, and this module is reachable from app.ts (the #594 class).
// ---------------------------------------------------------------------------

import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { ChatMessage, ContentPart, InferenceProvider, RoundRequest } from './types'

/** The slice of an Anthropic client this adapter uses (first-party in tests, AnthropicBedrock in production). */
export interface AnthropicStreamClient {
  readonly beta: { readonly messages: Pick<Anthropic['beta']['messages'], 'stream'> }
}

function toParam(part: ContentPart): BetaContentBlockParam | null {
  switch (part.type) {
    case 'text':
      return part.text ? { type: 'text', text: part.text } : null
    case 'tool_use':
      return { type: 'tool_use', id: part.id, name: part.name, input: part.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolUseId,
        content: part.content,
        is_error: part.isError,
      }
    case 'reasoning':
      return part.raw as BetaContentBlockParam
  }
}

function toMessageParam(m: ChatMessage): BetaMessageParam {
  return {
    role: m.role,
    content: m.content.map(toParam).filter((b): b is BetaContentBlockParam => b !== null),
  }
}

/** Messages-API request params for one round. Exported for the adapter test. */
export function buildMessagesParams(modelId: string, req: RoundRequest) {
  const system: BetaTextBlockParam[] = req.system
    .filter((s) => s)
    .map((text) => ({ type: 'text' as const, text }))
  // The breakpoint on the last system block caches tools (which precede the
  // system prompt in the prefix) plus the whole system prompt.
  const last = system.at(-1)
  if (req.cache && last)
    system[system.length - 1] = { ...last, cache_control: { type: 'ephemeral' } }
  return {
    model: modelId,
    max_tokens: req.maxTokens,
    system,
    messages: req.messages.map(toMessageParam),
    tools: req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as { type: 'object' },
    })),
    output_config: { effort: req.effort },
  }
}

export function anthropicProvider(
  modelId: string,
  client: AnthropicStreamClient,
  name = 'bedrock-anthropic',
): InferenceProvider {
  return {
    name,
    modelId,
    async *streamRound(request, signal) {
      const stream = client.beta.messages.stream(
        buildMessagesParams(modelId, request),
        signal ? { signal } : undefined,
      )
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text }
        }
      }
      const message = await stream.finalMessage()
      const content: ContentPart[] = []
      for (const b of message.content) {
        if (b.type === 'text') content.push({ type: 'text', text: b.text })
        else if (b.type === 'tool_use') {
          content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          content.push({ type: 'reasoning', raw: b })
        }
      }
      yield {
        type: 'round_end',
        content,
        stopReason: message.stop_reason ?? null,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
      }
    },
  }
}

export async function createAnthropicBedrockProvider(opts: {
  modelId: string
  region: string
}): Promise<InferenceProvider> {
  const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
  const client = new AnthropicBedrock({ awsRegion: opts.region })
  return anthropicProvider(opts.modelId, client as unknown as AnthropicStreamClient)
}
