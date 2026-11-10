// Tool registry: the permission filter and the run-time re-check (plan
// "Verification" 1 and 2). Real Cedar (offline wasm), no database.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { _clearAuthzCache } from '../../lib/authz'
import type { Principal } from '../../lib/authz.types'
import { ALL_TOOLS, findTool, offeredTools, runTool, toolInputSchema } from './registry'
import type { ToolContext } from './types'

function ctx(roleNames: string[], fetchApi = vi.fn()): ToolContext {
  const principal: Principal = { sub: 'sub-1', tenantId: 't-1', roleNames }
  return { principal, idToken: 'tok', policyStoreId: undefined, fetchApi }
}

const names = async (roles: string[]) => (await offeredTools(ctx(roles))).map((t) => t.name)

beforeEach(() => {
  _clearAuthzCache()
  process.env['AUTHZ_OFFLINE'] = 'true'
})

describe('offeredTools', () => {
  it('a driver is never offered list_invoices', async () => {
    expect(await names(['driver'])).not.toContain('list_invoices')
  })

  it('an accountant is offered list_invoices but no longhaul Operations tools', async () => {
    const offered = await names(['accountant'])
    expect(offered).toContain('list_invoices')
    expect(offered).not.toContain('search_trips')
  })

  it('operations_admin gets the Operations tools only — its Cedar persona grants no entity reads', async () => {
    expect(await names(['operations_admin'])).toEqual([
      'get_trip',
      'list_drivers',
      'search_shipments',
      'search_trips',
    ])
  })

  it('tenant_admin is offered every tool, in stable name order', async () => {
    const offered = await names(['tenant_admin'])
    expect(offered).toEqual(ALL_TOOLS.map((t) => t.name))
    expect(offered).toEqual([...offered].sort())
  })

  it('an empty-roles principal is offered nothing', async () => {
    expect(await names([])).toEqual([])
  })
})

describe('runTool', () => {
  it('re-checks the gate: a principal without the action is denied and the API is never called', async () => {
    const fetchApi = vi.fn()
    const out = await runTool(findTool('list_invoices')!, {}, ctx(['driver'], fetchApi))
    expect(out.allowed).toBe(false)
    expect(out.isError).toBe(true)
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it('re-checks the Operations gate the same way', async () => {
    const fetchApi = vi.fn()
    const out = await runTool(findTool('get_trip')!, { trip_id: 1 }, ctx(['accountant'], fetchApi))
    expect(out.allowed).toBe(false)
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it('rejects input that fails the schema without calling the API', async () => {
    const fetchApi = vi.fn()
    const out = await runTool(
      findTool('get_trip')!,
      { trip_id: 'abc' },
      ctx(['tenant_admin'], fetchApi),
    )
    expect(out.isError).toBe(true)
    expect(out.allowed).toBe(true)
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it('caps a list at 20 rows and says it was truncated', async () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({ driver_id: i + 1, driver_name: `D${i}` }))
    const fetchApi = vi.fn(async () => Response.json({ data: rows }))
    const out = await runTool(findTool('list_drivers')!, {}, ctx(['tenant_admin'], fetchApi))
    expect(fetchApi).toHaveBeenCalledWith('/api/v1/onprem/longhaul/drivers')
    const data = JSON.parse(out.content) as { rows: unknown[]; truncated: boolean; note?: string }
    expect(out.resultCount).toBe(20)
    expect(data.rows).toHaveLength(20)
    expect(data.truncated).toBe(true)
    expect(data.note).toMatch(/narrow/i)
  })

  it('turns an endpoint 403 into a model-safe message', async () => {
    const fetchApi = vi.fn(async () =>
      Response.json({ error: 'nope', code: 'FORBIDDEN' }, { status: 403 }),
    )
    const out = await runTool(findTool('list_moves')!, {}, ctx(['tenant_admin'], fetchApi))
    expect(out.isError).toBe(true)
    expect(out.content).toBe('The user does not have access to this data.')
  })

  it('builds the shipments filter the planning endpoint expects', async () => {
    const fetchApi = vi.fn(async (_path: string) => Response.json({ data: [] }))
    await runTool(
      findTool('search_shipments')!,
      { origin_states: ['tx'], load_from: '2026-11-10', assigned: 'no' },
      ctx(['operations_admin'], fetchApi),
    )
    const path = fetchApi.mock.calls[0]?.[0] as string
    const filters = JSON.parse(decodeURIComponent(path.split('filters=')[1]!)) as {
      filters: Record<string, unknown>
    }
    expect(filters.filters).toEqual({
      origin: [{ value: 'TX' }],
      load_date: ['2026-11-10', null],
      assigned: [{ value: 'No' }],
    })
  })
})

describe('toolInputSchema', () => {
  it('gives every tool an object JSON Schema without a $schema key', () => {
    for (const tool of ALL_TOOLS) {
      const schema = toolInputSchema(tool)
      expect(schema['type']).toBe('object')
      expect(schema['$schema']).toBeUndefined()
    }
  })
})
