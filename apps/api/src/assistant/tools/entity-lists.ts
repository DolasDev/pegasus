// The cloud entity lists — customers, quotes, invoices, moves — each behind its
// own Cedar read action. These routes page newest-first; the tool asks for one
// page of MAX_ROWS + 1 so it can tell the model when there is more.
//
// The Cedar gate here is load-bearing, not decorative: GET /customers, /quotes
// and /invoices on the v1 router carry no `requirePermission` of their own.

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { AssistantTool } from './types'
import { MAX_ROWS, capped, dataArray, pick } from './shared'

const input = z
  .object({
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Skip this many rows (newest first) to page further back'),
  })
  .strict()

const page = (base: string, i: z.infer<typeof input>) =>
  `${base}?limit=${MAX_ROWS + 1}&offset=${i.offset ?? 0}`

const money = (v: unknown): string | undefined => {
  const m = v as { amount?: number; currency?: string } | null | undefined
  return m && typeof m.amount === 'number'
    ? `${m.amount.toFixed(2)} ${m.currency ?? ''}`.trim()
    : undefined
}

const addr = (v: unknown): string | undefined => {
  const a = v as { city?: string; state?: string } | null | undefined
  return a?.city || a?.state ? [a.city, a.state].filter(Boolean).join(', ') : undefined
}

const PAGE_NOTE = 'Returns one page of at most 20 rows, newest first; pass `offset` to page.'

export const listCustomers: AssistantTool<typeof input> = {
  name: 'list_customers',
  description: `Call this when the user asks about customers in Pegasus (names, emails, phone numbers). ${PAGE_NOTE}`,
  input,
  gate: { kind: 'cedar', action: Actions.ReadCustomer },
  request: (i) => page('/api/v1/customers', i),
  project: (body) =>
    capped(dataArray(body), (r) =>
      pick(r, ['id', 'firstName', 'lastName', 'email', 'phone', 'createdAt']),
    ),
}

export const listQuotes: AssistantTool<typeof input> = {
  name: 'list_quotes',
  description: `Call this when the user asks about quotes: their status (DRAFT, SENT, ACCEPTED…), price or expiry. ${PAGE_NOTE}`,
  input,
  gate: { kind: 'cedar', action: Actions.ReadQuote },
  request: (i) => page('/api/v1/quotes', i),
  project: (body) =>
    capped(dataArray(body), (r) => {
      const q = r as Record<string, unknown>
      return {
        ...pick(q, ['id', 'moveId', 'status', 'validUntil', 'createdAt']),
        price: money(q['price']),
      }
    }),
}

export const listInvoices: AssistantTool<typeof input> = {
  name: 'list_invoices',
  description: `Call this when the user asks about invoices or billing: status, totals, due dates. ${PAGE_NOTE}`,
  input,
  gate: { kind: 'cedar', action: Actions.ReadInvoice },
  request: (i) => page('/api/v1/invoices', i),
  project: (body) =>
    capped(dataArray(body), (r) => {
      const inv = r as Record<string, unknown>
      return {
        ...pick(inv, ['id', 'moveId', 'status', 'issuedAt', 'dueAt']),
        total: money(inv['total']),
        payments: Array.isArray(inv['payments']) ? inv['payments'].length : undefined,
      }
    }),
}

export const listMoves: AssistantTool<typeof input> = {
  name: 'list_moves',
  description: `Call this when the user asks about moves managed in Pegasus (not longhaul shipments): status, scheduled date, origin and destination. ${PAGE_NOTE}`,
  input,
  gate: { kind: 'cedar', action: Actions.ListMoves },
  request: (i) => page('/api/v1/moves', i),
  project: (body) =>
    capped(dataArray(body), (r) => {
      const m = r as Record<string, unknown>
      return {
        ...pick(m, ['id', 'status', 'scheduledDate', 'customerId']),
        origin: addr(m['origin']),
        destination: addr(m['destination']),
      }
    }),
}
