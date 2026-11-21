// ---------------------------------------------------------------------------
// The agent loop: one user question → one streamed answer, with every tool call
// traced. The loop is OURS and runs over the provider-neutral round seam
// (lib/inference/types.ts), so the same loop drives Bedrock Converse or the
// Anthropic Messages path and the model is configuration. Plans:
// plans/*/ai-chat-assistant.md (1c) and plans/*/assistant-converse.md (D3).
//
// Every round is a complete, self-contained request: system prompt, tools and
// the whole message list. Nothing depends on server-held state.
// ---------------------------------------------------------------------------

import type {
  ChatMessage,
  ContentPart,
  Effort,
  InferenceProvider,
  RoundEvent,
  ToolSpec,
} from '../lib/inference/types'
import type { ToolCallTrace } from '../repositories/assistant.repository'
import { offeredTools, runTool, toolInputSchema, type ToolOutcome } from './tools/registry'
import type { AssistantTool, ToolContext } from './tools/types'
import { systemBlocks, userContent, type PromptSource } from './prompt'

export type { Effort } from '../lib/inference/types'

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
  /** Prior turns, oldest first, text only (see historyFromTurns). */
  readonly history: readonly ChatMessage[]
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

type ToolUse = Extract<ContentPart, { type: 'tool_use' }>

function failed(message: string, allowed = true): ToolOutcome {
  return { allowed, content: message, isError: true, resultCount: null, error: message }
}

export async function runTurn(input: RunTurnInput): Promise<TurnResult> {
  const started = Date.now()
  const emit = input.onEvent ?? (() => {})
  const offered = await offeredTools(input.tool)
  emit({ type: 'tools', offered: offered.map((t) => t.name) })

  const byName = new Map<string, AssistantTool>(offered.map((t) => [t.name, t]))
  const tools: ToolSpec[] = offered.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toolInputSchema(t),
  }))
  const system = systemBlocks(input.prompt)
  const question = userContent(input.question, input.now, input.timeZone)
  const messages: ChatMessage[] = [...input.history, { role: 'user', content: question }]
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS

  const toolCalls: ToolCallTrace[] = []
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let rounds = 0
  let lastContent: readonly ContentPart[] = []
  let stopReason: string | null = null
  let error: string | null = null

  /** Run one tool call: re-check the permission, run it as the caller, trace it. */
  async function call(use: ToolUse): Promise<ContentPart> {
    emit({ type: 'tool_start', id: use.id, name: use.name, input: use.input })
    const t0 = Date.now()
    const tool = byName.get(use.name)
    let out: ToolOutcome
    if (use.inputError) out = failed(use.inputError)
    else if (!tool) out = failed(`There is no tool named ${use.name}.`, false)
    else out = await runTool(tool, use.input, input.tool)
    const durationMs = Date.now() - t0
    toolCalls.push({
      toolUseId: use.id,
      toolName: use.name,
      input: use.input,
      allowed: out.allowed,
      resultCount: out.resultCount,
      resultSummary: out.content,
      error: out.error,
      durationMs,
    })
    emit({
      type: 'tool_end',
      id: use.id,
      name: use.name,
      allowed: out.allowed,
      isError: out.isError,
      resultCount: out.resultCount,
      durationMs,
    })
    return { type: 'tool_result', toolUseId: use.id, content: out.content, isError: out.isError }
  }

  try {
    while (rounds < maxRounds) {
      input.signal?.throwIfAborted()
      let end: Extract<RoundEvent, { type: 'round_end' }> | null = null
      const round = input.provider.streamRound(
        {
          system,
          tools,
          messages: [...messages],
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          // The primary cost/latency lever after tool-result size; swept in the Lab.
          effort: input.effort ?? 'medium',
          cache: true,
        },
        input.signal,
      )
      for await (const ev of round) {
        if (ev.type === 'text_delta') emit({ type: 'text', text: ev.text })
        else end = ev
      }
      if (!end) throw new Error('The model round ended without a result.')

      rounds += 1
      usage.inputTokens += end.usage.inputTokens
      usage.outputTokens += end.usage.outputTokens
      usage.cacheReadTokens += end.usage.cacheReadTokens
      usage.cacheWriteTokens += end.usage.cacheWriteTokens
      lastContent = end.content
      stopReason = end.stopReason

      const uses = end.content.filter((p): p is ToolUse => p.type === 'tool_use')
      // max_tokens, content filters, guardrails and plain end_turn all stop here.
      if (end.stopReason !== 'tool_use' || uses.length === 0 || rounds >= maxRounds) break

      // The whole assistant message goes back unchanged, reasoning included:
      // providers verify reasoning signatures on the next round of the turn.
      messages.push({ role: 'assistant', content: end.content })
      // Tool calls from one round run in parallel; results go back in the
      // model's order. (The SDK tool runner this replaced did the same.)
      const results = await Promise.all(uses.map(call))
      messages.push({ role: 'user', content: results })
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const text = lastContent
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')

  return {
    text,
    userContent: question,
    offered: offered.map((t) => t.name),
    stopReason,
    rounds,
    usage,
    toolCalls,
    latencyMs: Date.now() - started,
    modelId: input.provider.modelId,
    error,
  }
}

/**
 * Rebuild conversation history from stored turns. Turns are persisted as
 * `[{type: 'text', text}]` blocks, an app-owned shape that is not tied to any
 * provider. Only text is kept: tool traffic lives in AssistantToolCall, and
 * reasoning never crosses turns.
 *
 * Converse requires strict user/assistant alternation, starting with a user
 * message. The Anthropic API quietly merged same-role runs; Converse rejects
 * them. A failed exchange leaves a stored question with no stored answer, so
 * same-role runs are merged, leading assistant turns are dropped, and a
 * trailing unanswered question is dropped (the new question follows it).
 */
export function historyFromTurns(
  turns: ReadonlyArray<{ role: string; content: unknown }>,
): ChatMessage[] {
  const out: Array<{ role: 'user' | 'assistant'; content: ContentPart[] }> = []
  for (const t of turns) {
    if (t.role !== 'user' && t.role !== 'assistant') continue
    const content = (Array.isArray(t.content) ? (t.content as unknown[]) : [])
      .filter(
        (b): b is { type: 'text'; text: string } =>
          typeof b === 'object' &&
          b !== null &&
          (b as { type?: unknown }).type === 'text' &&
          typeof (b as { text?: unknown }).text === 'string',
      )
      .map((b) => ({ type: 'text' as const, text: b.text }))
    if (content.length === 0) continue
    const prev = out.at(-1)
    if (prev?.role === t.role) prev.content.push(...content)
    else if (out.length > 0 || t.role === 'user') out.push({ role: t.role, content })
  }
  if (out.at(-1)?.role === 'user') out.pop()
  return out
}
