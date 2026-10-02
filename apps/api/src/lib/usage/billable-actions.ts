// ---------------------------------------------------------------------------
// The billable-action registry — what the usage meter counts.
//
// A billable action is a successful, first-time mutation that reaches the
// outside world, performed by an API client (a workflow runtime or a plain
// integration client) on the tenant's behalf. Reads, workflow state, runs,
// dry runs, non-2xx responses, idempotent replays and anything a human does
// through tenant-web are free. The full counted/free table and its reasoning
// live in plans/in-progress/usage-metering.md.
//
// Each entry decides, from a 2xx response's `data` envelope (plus the request
// for the outbound caller), whether this response is billable and which
// subject it counts against. `middleware/meter-usage.ts` has already dropped
// humans, non-2xx and `data.already* === true` replays before it asks.
//
// Adding a billable route (the Phase 5 standing rule): add its entry here, put
// `meterUsage(Actions.X)` on the route, and add it to the SDK README's
// billable list — in the same PR.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import type { AppEnv } from '../../types'
import type { Actions } from '../../authz/actions'
import { isIdempotent } from '../outbound-retry'

/** A response's `data` envelope. */
export type ResponseData = Record<string, unknown>

export interface BillableAction {
  /** True when this (2xx, non-replay) response is a billable action. */
  billable(data: ResponseData, c: Context<AppEnv>): boolean | Promise<boolean>
  /**
   * The meter's dedup key within (tenant, action). The same subject counted
   * twice is one action. Null means the response lacks the field the key is
   * built from — a contract break, which the meter reports as a failure.
   */
  subjectKey(data: ResponseData, c: Context<AppEnv>): string | null
}

/** `data.id` as a key segment. Numbers are stringified so `123` and `"123"` are one subject. */
function idOf(data: ResponseData): string | null {
  const id = data['id']
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return typeof id === 'string' && id ? id : null
}

function idKey(prefix: string): BillableAction['subjectKey'] {
  return (data) => {
    const id = idOf(data)
    return id === null ? null : `${prefix}:${id}`
  }
}

const always = (): boolean => true

/**
 * Keyed by Cedar action id. `satisfies` makes a key that isn't a real
 * `Actions` member a compile error.
 */
export const BILLABLE_ACTIONS = {
  // POST /sms/send — 202 new, 200 `alreadySent` replay. `data.id` is
  // RingCentral's message id: a number on a new send, the stored string on a
  // replay (services/sms/outbound.ts), so it is normalized. RingCentral may
  // return no id; a 202 still means a text went out, so the key is minted.
  SendSms: {
    billable: always,
    subjectKey: (data) => `sms:${idOf(data) ?? `unidentified:${randomUUID()}`}`,
  },
  // POST /email/send — same contract as /sms/send. Keyed on the EmailSend row.
  SendEmail: { billable: always, subjectKey: idKey('email') },
  // POST /sms/messages/:id/read — `alreadyRead` replay. Keyed on the message.
  UpdateTextMessage: { billable: always, subjectKey: idKey('read') },
  // POST /pegii/tasks/close — `alreadyClosed` replay. Keyed on the task.
  CloseTask: { billable: always, subjectKey: idKey('close') },
  // POST /integrations/:id/deliver-to-external. The handler answers 200 even
  // when the PARTNER failed (`delivered: response.ok`), so read that, not the
  // HTTP status. No dedup key or stable result id exists, so every successful
  // delivery counts once: the key is minted server-side. The request's
  // correlation id is client-suppliable and would let a caller collapse N
  // deliveries into one row, so it is stored but never keyed on.
  DeliverToExternal: {
    billable: (data) => data['delivered'] === true && data['dryRun'] !== true,
    subjectKey: () => `deliver:${randomUUID()}`,
  },
  // POST /integrations/:id/call-external. Same partner-status envelope (`ok`).
  // Only MUTATING calls count: a GET is a read, and reads run live under
  // `run --dry-run`, so billing them would bill dry runs. Classified exactly
  // as the outbound retry policy and the SDK's dry-run split classify it
  // (`isIdempotent(method, mutating)`).
  CallExternal: {
    billable: async (data, c) => {
      if (data['ok'] !== true || data['dryRun'] === true) return false
      const body = (await c.req.json()) as { method?: unknown; mutating?: unknown }
      const method = typeof body.method === 'string' ? body.method : 'GET'
      const mutating = typeof body.mutating === 'boolean' ? body.mutating : undefined
      return !isIdempotent(method, mutating)
    },
    subjectKey: () => `call:${randomUUID()}`,
  },
} as const satisfies { [K in keyof typeof Actions]?: BillableAction }

export type BillableActionId = keyof typeof BILLABLE_ACTIONS

export function isBillableActionId(id: string): id is BillableActionId {
  return Object.hasOwn(BILLABLE_ACTIONS, id)
}

const RUNTIME_CLIENT_PREFIX = 'wf-runtime-'

/**
 * A workflow runtime's key is its own ApiClient named `wf-runtime-<workflowId>`
 * (lib/start-workflow-execution.ts), so the client name attributes an action
 * to a workflow. Any other name is a plain API client: null.
 */
export function workflowIdFromClientName(name: string): string | null {
  if (!name.startsWith(RUNTIME_CLIENT_PREFIX)) return null
  const id = name.slice(RUNTIME_CLIENT_PREFIX.length)
  return id.length > 0 ? id : null
}
