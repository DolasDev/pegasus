// ---------------------------------------------------------------------------
// The agent loop: one user question → one streamed answer, with every tool call
// traced. Built on the SDK tool runner (not a hand-rolled loop); the runnable
// tools' `run` callbacks are where the permission re-check and trace capture
// attach. Plan: plans/*/ai-chat-assistant.md (1c).
// ---------------------------------------------------------------------------

import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { ToolError } from '@anthropic-ai/sdk/lib/tools/ToolError'
import type {
  BetaMessage,
  BetaMessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { InferenceProvider } from '../lib/inference/provider'
import type { ToolCallTrace } from '../repositories/assistant.repository'
import { offeredTools, runTool, toolInputSchema } from './tools/registry'
import type { ToolContext } from './tools/types'
import { systemBlocks, userContent, type PromptSource } from './prompt'

export type Effort = 'low' | 'medium' | 'high'

/** Streamed to the client as server-sent events. */
export type AssistantEvent =
  | { type: 'tools'; offered: string[] }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | {
      type: 'tool_end'
      id: string
      name: string
      allowed: boolean
      isError: boolean
      resultCount: number | null
      durationMs: number
    }

export interface RunTurnInput {
  readonly provider: InferenceProvider
  readonly tool: ToolContext
  readonly prompt: PromptSource
  /** Prior turns, oldest first, already in Messages-API shape. */
  readonly history: readonly BetaMessageParam[]
  readonly question: string
  readonly now: Date
  readonly timeZone?: string
  readonly effort?: Effort
  readonly maxTokens?: number
  /** Model rounds allowed before the loop stops (bounds cost on a runaway). */
  readonly maxRounds?: number
  readonly onEvent?: (e: AssistantEvent) => void
  readonly signal?: AbortSignal
}

export interface TurnResult {
  readonly text: string
  readonly userContent: unknown[]
  readonly offered: string[]
  readonly stopReason: string | null
  readonly rounds: number
  readonly usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  readonly toolCalls: ToolCallTrace[]
  readonly latencyMs: number
  readonly modelId: string
  readonly error: string | null
}

const DEFAULT_MAX_TOKENS = 4_096
const DEFAULT_MAX_ROUNDS = 8

export async function runTurn(input: RunTurnInput): Promise<TurnResult> {
  const started = Date.now()
  const emit = input.onEvent ?? (() => {})
  const offered = await offeredTools(input.tool)
  emit({ type: 'tools', offered: offered.map((t) => t.name) })

  const toolCalls: ToolCallTrace[] = []
  const tools = offered.map((t) =>
    betaTool({
      name: t.name,
      description: t.description,
      inputSchema: toolInputSchema(t) as { type: 'object' },
      run: async (args: unknown, context) => {
        const id =
          context?.toolUseBlock && 'id' in context.toolUseBlock ? context.toolUseBlock.id : ''
        emit({ type: 'tool_start', id, name: t.name, input: args })
        const t0 = Date.now()
        const out = await runTool(t, args, input.tool)
        const durationMs = Date.now() - t0
        toolCalls.push({
          toolUseId: id,
          toolName: t.name,
          input: args,
          allowed: out.allowed,
          resultCount: out.resultCount,
          resultSummary: out.content,
          error: out.error,
          durationMs,
        })
        emit({
          type: 'tool_end',
          id,
          name: t.name,
          allowed: out.allowed,
          isError: out.isError,
          resultCount: out.resultCount,
          durationMs,
        })
        if (out.isError) throw new ToolError(out.content)
        return out.content
      },
    }),
  )

  const question = userContent(input.question, input.now, input.timeZone)
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let rounds = 0
  let last: BetaMessage | null = null
  let error: string | null = null

  try {
    const runner = input.provider.client.beta.messages.toolRunner(
      {
        model: input.provider.modelId,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        max_iterations: input.maxRounds ?? DEFAULT_MAX_ROUNDS,
        system: systemBlocks(input.prompt),
        messages: [...input.history, { role: 'user', content: question }],
        tools,
        // The primary cost/latency lever after tool-result size; swept in the Lab.
        output_config: { effort: input.effort ?? 'medium' },
        stream: true,
        // REQUIRED. SDK 1.8's tool runner defaults to server-held message
        // threads: round 1 sends `thread: {type: 'create'}` and later rounds send
        // only the new tool_result plus `previous_message_id` — no system prompt,
        // no tools, no history. Threads are an Anthropic-hosted feature; on the
        // Bedrock invoke path there is no thread to continue. `false` makes every
        // round a complete, self-contained request (pinned by loop.test.ts).
        thread: false,
      },
      input.signal ? { signal: input.signal } : undefined,
    )
    for await (const stream of runner) {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          emit({ type: 'text', text: event.delta.text })
        }
      }
      const message = await stream.finalMessage()
      rounds += 1
      last = message
      usage.inputTokens += message.usage.input_tokens
      usage.outputTokens += message.usage.output_tokens
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0
      usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const text =
    last?.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('') ?? ''

  return {
    text,
    userContent: question,
    offered: offered.map((t) => t.name),
    stopReason: last?.stop_reason ?? null,
    rounds,
    usage,
    toolCalls,
    latencyMs: Date.now() - started,
    modelId: input.provider.modelId,
    error,
  }
}

/** Rebuild Messages-API history from stored turns (text only, as persisted). */
export function historyFromTurns(
  turns: ReadonlyArray<{ role: string; content: unknown }>,
): BetaMessageParam[] {
  const out: BetaMessageParam[] = []
  for (const t of turns) {
    if (t.role !== 'user' && t.role !== 'assistant') continue
    const content = Array.isArray(t.content) ? t.content : []
    if (content.length === 0) continue
    out.push({ role: t.role, content } as BetaMessageParam)
  }
  return out
}
