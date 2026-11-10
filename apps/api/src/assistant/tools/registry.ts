// ---------------------------------------------------------------------------
// Tool registry: which tools a caller is OFFERED, and running one.
//
// Two checks, by design (plan 1b):
//   1. offeredTools() filters the registry by the caller's own permissions, so
//      the model is never even told about data the user can't read. A driver
//      asking a billing question gets "I don't have access to that" because the
//      tool was never offered — not because the model chose to decline.
//   2. runTool() checks the same gate AGAIN before executing. A tool that leaks
//      into the offered list (bug, stale cache, prompt injection naming a tool)
//      still cannot run.
// Then the endpoint itself runs as the caller, with its own auth and scoping.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { authorize } from '../../lib/authz'
import { hasOperationsRole } from '../../lib/longhaul-read-scope'
import type { AssistantTool, ToolContext } from './types'
import { searchShipments } from './search-shipments'
import { searchTrips } from './search-trips'
import { getTrip } from './get-trip'
import { listDrivers } from './list-drivers'
import { listCustomers, listInvoices, listMoves, listQuotes } from './entity-lists'

/** Sorted by name: tool order is part of the cached prompt prefix. */
export const ALL_TOOLS: readonly AssistantTool[] = (
  [
    searchShipments,
    searchTrips,
    getTrip,
    listDrivers,
    listCustomers,
    listQuotes,
    listInvoices,
    listMoves,
  ] as AssistantTool[]
).sort((a, b) => a.name.localeCompare(b.name))

export function findTool(name: string): AssistantTool | undefined {
  return ALL_TOOLS.find((t) => t.name === name)
}

export async function isToolPermitted(
  tool: AssistantTool,
  ctx: Pick<ToolContext, 'principal' | 'idToken' | 'policyStoreId'>,
): Promise<boolean> {
  if (tool.gate.kind === 'operations') return hasOperationsRole(ctx.principal.roleNames)
  const decision = await authorize({
    principal: ctx.principal,
    action: tool.gate.action,
    idToken: ctx.idToken,
    policyStoreId: ctx.policyStoreId,
  })
  return decision.allowed
}

/** The tools this caller may be offered, in stable (name) order. */
export async function offeredTools(
  ctx: Pick<ToolContext, 'principal' | 'idToken' | 'policyStoreId'>,
): Promise<AssistantTool[]> {
  const out: AssistantTool[] = []
  for (const tool of ALL_TOOLS) {
    if (await isToolPermitted(tool, ctx)) out.push(tool)
  }
  return out
}

/** JSON Schema for the model, derived from the tool's zod input. */
export function toolInputSchema(tool: AssistantTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { target: 'draft-2020-12' }) as Record<string, unknown>
  delete schema['$schema']
  return schema
}

export interface ToolOutcome {
  /** False when the gate denied the call (recorded on the trace). */
  readonly allowed: boolean
  /** What the model sees as the tool_result content. */
  readonly content: string
  readonly isError: boolean
  readonly resultCount: number | null
  readonly error: string | null
}

/** Model-facing bound on one tool result, after projection. */
const MAX_RESULT_CHARS = 24_000

function errorOutcome(message: string, allowed = true): ToolOutcome {
  return { allowed, content: message, isError: true, resultCount: null, error: message }
}

/** Short, model-safe text for a non-2xx endpoint answer. */
async function describeFailure(res: Response): Promise<string> {
  let code = ''
  let message = ''
  try {
    const body = (await res.json()) as { code?: string; error?: string }
    code = body.code ?? ''
    message = body.error ?? ''
  } catch {
    // not JSON — status alone
  }
  if (res.status === 403) return 'The user does not have access to this data.'
  if (res.status === 404) return 'Not found (or not visible to this user).'
  if (code === 'RESULT_LIMIT_EXCEEDED')
    return 'Too many matches — narrow the filters and try again.'
  return `The lookup failed (${res.status}${code ? ` ${code}` : ''})${message ? `: ${message}` : ''}.`
}

export async function runTool(
  tool: AssistantTool,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!(await isToolPermitted(tool, ctx))) {
    return errorOutcome('The user does not have access to this tool.', false)
  }
  const parsed = tool.input.safeParse(rawInput ?? {})
  if (!parsed.success) {
    return errorOutcome(`Invalid input: ${z.prettifyError(parsed.error)}`)
  }
  let res: Response
  try {
    res = await ctx.fetchApi(tool.request(parsed.data))
  } catch (err) {
    return errorOutcome(`The lookup failed: ${String(err)}`)
  }
  if (!res.ok) return errorOutcome(await describeFailure(res))

  const body: unknown = await res.json()
  const { resultCount, data } = tool.project(body, parsed.data)
  let content = JSON.stringify(data)
  if (content.length > MAX_RESULT_CHARS) {
    content = `${content.slice(0, MAX_RESULT_CHARS)}… [result cut at ${MAX_RESULT_CHARS} characters — narrow the request]`
  }
  return { allowed: true, content, isError: false, resultCount, error: null }
}
