// ---------------------------------------------------------------------------
// Assistant tool contract.
//
// A tool IS an existing read endpoint. `request()` turns the model's validated
// input into a path under /api/v1, the loop executes it in-process against the
// real Hono app AS THE CALLER (their own ID token), and `project()` narrows the
// response to the few columns an answer needs. Auth, Cedar, driver scoping and
// the on-prem SQL path are therefore the endpoint's own — nothing is
// re-implemented here. See plans/in-progress/ai-chat-assistant.md (1b).
// ---------------------------------------------------------------------------

import type { z } from 'zod'
import type { ActionDef } from '../../authz/actions'
import type { Principal } from '../../lib/authz.types'

/**
 * Who may be OFFERED a tool, and who may RUN it (checked again at run time —
 * defense in depth, so a tool that leaks into the offered list still can't
 * execute).
 *
 * - `cedar`: the caller must hold this Cedar action. Load-bearing for routes
 *   like GET /quotes that carry no `requirePermission` of their own.
 * - `operations`: the longhaul Operations surface, which is not Cedar-gated
 *   anywhere; it is gated by role name (OPERATIONS_ROLES), exactly as the
 *   longhaul handlers' own read scoping is.
 */
export type ToolGate = { kind: 'cedar'; action: ActionDef } | { kind: 'operations' }

export interface ToolProjection {
  /** Rows the model sees, when the tool returns a list. */
  readonly resultCount: number | null
  /** JSON-serializable, already narrowed and capped. */
  readonly data: unknown
}

export interface AssistantTool<Schema extends z.ZodType = z.ZodType> {
  /** snake_case; the registry sorts by it so the cached prompt prefix is stable. */
  readonly name: string
  /** Prescriptive: WHEN to call it, and that its results are capped. */
  readonly description: string
  readonly input: Schema
  readonly gate: ToolGate
  /** Path + query under the app root, e.g. `/api/v1/onprem/longhaul/trips/42`. */
  request(input: z.infer<Schema>): string
  project(body: unknown, input: z.infer<Schema>): ToolProjection
}

/** Everything a tool run needs about the caller and how to reach the API. */
export interface ToolContext {
  readonly principal: Principal
  readonly idToken: string
  readonly policyStoreId: string | undefined
  /**
   * Executes a GET against the app in-process with the caller's token. Injected
   * (not imported) so the assistant module never imports app.ts.
   */
  readonly fetchApi: (path: string) => Promise<Response>
}
