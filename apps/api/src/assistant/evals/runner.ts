// ---------------------------------------------------------------------------
// Eval runner: replays the ops-authored eval set through the real loop and
// grades each answer. This is what makes prompt iteration a measured loop
// rather than vibes (plan 1e, "Eval runner"; Verification 3).
//
// Grading is deterministic, from the case itself: every `mustInclude` substring
// must appear and no `mustNotInclude` substring may (case-insensitive). A case
// with neither is reported `ungraded` — it counts toward nothing, so an
// unfinished eval set can't masquerade as a passing one.
//
// Role scoping: the tool list is filtered for the case's `askedAs` role, so a
// "driver asks a billing question" case sees exactly a driver's tools. The data
// lookups themselves still run as the Lab user (the API derives the principal
// from their token; nothing lets a request claim another role). So a case's
// TOOL OFFER is exact, but row scoping inside an endpoint (e.g. a driver seeing
// only their own moves) reflects the Lab user, not the case role.
// ---------------------------------------------------------------------------

import type { InferenceProvider } from '../../lib/inference/provider'
import type { Principal } from '../../lib/authz.types'
import { runTurn, type Effort } from '../loop'
import type { PromptSource } from '../prompt'
import type { ToolContext } from '../tools/types'
import type { AssistantEvalCase } from './schema'

export type CaseVerdict = 'pass' | 'fail' | 'ungraded' | 'error'

export interface CaseResult {
  readonly id: string
  readonly askedAs: string
  readonly verdict: CaseVerdict
  /** Why it failed: the missing / forbidden substrings, or the error. */
  readonly reasons: string[]
  readonly answer: string
  readonly toolsCalled: string[]
  readonly toolsOffered: string[]
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly latencyMs: number
}

export interface EvalSummary {
  readonly total: number
  readonly graded: number
  readonly passed: number
  /** passed / graded, or null when nothing is graded yet. */
  readonly passRate: number | null
  readonly meanToolCalls: number
  readonly meanInputTokens: number
  readonly meanOutputTokens: number
  readonly meanLatencyMs: number
}

/** Pure grading — exported for tests. */
export function grade(
  answer: string,
  expected: AssistantEvalCase['expected'],
): { verdict: Exclude<CaseVerdict, 'error'>; reasons: string[] } {
  if (expected.mustInclude.length === 0 && expected.mustNotInclude.length === 0) {
    return { verdict: 'ungraded', reasons: ['case has no mustInclude / mustNotInclude yet'] }
  }
  const hay = answer.toLowerCase()
  const reasons: string[] = []
  for (const s of expected.mustInclude) {
    if (!hay.includes(s.toLowerCase())) reasons.push(`missing "${s}"`)
  }
  for (const s of expected.mustNotInclude) {
    if (hay.includes(s.toLowerCase())) reasons.push(`contains forbidden "${s}"`)
  }
  return { verdict: reasons.length === 0 ? 'pass' : 'fail', reasons }
}

export interface RunCaseInput {
  readonly evalCase: AssistantEvalCase
  readonly provider: InferenceProvider
  readonly prompt: PromptSource
  /** The Lab user; only `roleNames` is replaced by the case's role. */
  readonly caller: Principal
  readonly idToken: string
  readonly policyStoreId: string | undefined
  readonly fetchApi: ToolContext['fetchApi']
  readonly now: Date
  readonly effort?: Effort
}

export async function runEvalCase(input: RunCaseInput): Promise<CaseResult> {
  const c = input.evalCase
  const tool: ToolContext = {
    principal: { ...input.caller, roleNames: [c.askedAs] },
    idToken: input.idToken,
    policyStoreId: input.policyStoreId,
    fetchApi: input.fetchApi,
  }
  const turn = await runTurn({
    provider: input.provider,
    tool,
    prompt: input.prompt,
    history: [],
    question: c.question,
    now: input.now,
    ...(input.effort ? { effort: input.effort } : {}),
  })
  const base = {
    id: c.id,
    askedAs: c.askedAs,
    answer: turn.text,
    toolsCalled: turn.toolCalls.map((t) => t.toolName),
    toolsOffered: turn.offered,
    inputTokens: turn.usage.inputTokens,
    outputTokens: turn.usage.outputTokens,
    cacheReadTokens: turn.usage.cacheReadTokens,
    latencyMs: turn.latencyMs,
  }
  if (turn.error) return { ...base, verdict: 'error', reasons: [turn.error] }
  return { ...base, ...grade(turn.text, c.expected) }
}

export function summarize(results: readonly CaseResult[]): EvalSummary {
  const graded = results.filter(
    (r) => r.verdict === 'pass' || r.verdict === 'fail' || r.verdict === 'error',
  )
  const passed = results.filter((r) => r.verdict === 'pass').length
  const n = results.length || 1
  const mean = (f: (r: CaseResult) => number) => results.reduce((s, r) => s + f(r), 0) / n
  return {
    total: results.length,
    graded: graded.length,
    passed,
    passRate: graded.length ? passed / graded.length : null,
    meanToolCalls: mean((r) => r.toolsCalled.length),
    meanInputTokens: mean((r) => r.inputTokens),
    meanOutputTokens: mean((r) => r.outputTokens),
    meanLatencyMs: mean((r) => r.latencyMs),
  }
}
