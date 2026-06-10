// ---------------------------------------------------------------------------
// Unit tests for the workflow execution API wrappers — verify each wrapper
// calls the underlying client helper with the correct path/body.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
  apiFetchPaginated: vi.fn(),
}))

import { apiFetch, apiFetchPaginated } from '../api/client'
import {
  runWorkflow,
  listExecutions,
  getExecution,
  listTriggers,
  createTrigger,
  updateTrigger,
  deleteTrigger,
} from '../api/workflows'

const mockApiFetch = vi.mocked(apiFetch)
const mockApiFetchPaginated = vi.mocked(apiFetchPaginated)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('workflows execution API', () => {
  it('runWorkflow POSTs to /:id/run with the input body', async () => {
    const exec = { id: 'e-1', status: 'QUEUED' }
    mockApiFetch.mockResolvedValueOnce(exec)

    const result = await runWorkflow('wf-1', { to: 'a@b.com' })

    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/workflows/wf-1/run', {
      method: 'POST',
      body: JSON.stringify({ input: { to: 'a@b.com' } }),
    })
    expect(result).toEqual(exec)
  })

  it('listExecutions GETs /:id/executions with no query string by default', async () => {
    mockApiFetchPaginated.mockResolvedValueOnce({
      data: [],
      meta: { count: 0, limit: 50, total: 0, offset: 0 },
    })

    const result = await listExecutions('wf-1')

    expect(mockApiFetchPaginated).toHaveBeenCalledWith('/api/v1/workflows/wf-1/executions')
    expect(result).toEqual({ data: [], meta: { count: 0, limit: 50 } })
  })

  it('listExecutions threads limit + before into the query string', async () => {
    mockApiFetchPaginated.mockResolvedValueOnce({
      data: [],
      meta: { count: 0, limit: 10, total: 0, offset: 0 },
    })

    await listExecutions('wf-1', { limit: 10, before: 'e-9' })

    expect(mockApiFetchPaginated).toHaveBeenCalledWith(
      '/api/v1/workflows/wf-1/executions?limit=10&before=e-9',
    )
  })

  it('listExecutions normalises meta to only count + limit', async () => {
    // The shared client types meta as the superset PaginationMeta; the
    // executions endpoint only populates count + limit.
    mockApiFetchPaginated.mockResolvedValueOnce({
      data: [{ id: 'e-1' }],
      // total/offset arrive undefined at runtime — must not leak through.
      meta: { count: 1, limit: 50 } as never,
    })

    const result = await listExecutions('wf-1')

    expect(result.meta).toEqual({ count: 1, limit: 50 })
  })

  it('getExecution GETs /:id/executions/:executionId', async () => {
    const exec = { id: 'e-1', status: 'COMPLETED' }
    mockApiFetch.mockResolvedValueOnce(exec)

    const result = await getExecution('wf-1', 'e-1')

    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/workflows/wf-1/executions/e-1')
    expect(result).toEqual(exec)
  })
})

describe('workflows trigger API', () => {
  it('listTriggers GETs /:id/triggers', async () => {
    const triggers = [{ id: 't-1', kind: 'EVENT' }]
    mockApiFetch.mockResolvedValueOnce(triggers)

    const result = await listTriggers('wf-1')

    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/workflows/wf-1/triggers')
    expect(result).toEqual(triggers)
  })

  it('createTrigger POSTs the input to /:id/triggers', async () => {
    const created = { id: 't-1', kind: 'EVENT' }
    mockApiFetch.mockResolvedValueOnce(created)

    const input = {
      kind: 'EVENT' as const,
      eventType: 'quote.accepted',
      filter: { status: 'SENT' },
    }
    const result = await createTrigger('wf-1', input)

    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/workflows/wf-1/triggers', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    expect(result).toEqual(created)
  })

  it('updateTrigger PATCHes /:id/triggers/:triggerId', async () => {
    const updated = { id: 't-1', enabled: false }
    mockApiFetch.mockResolvedValueOnce(updated)

    const result = await updateTrigger('wf-1', 't-1', { enabled: false })

    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/workflows/wf-1/triggers/t-1', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    expect(result).toEqual(updated)
  })

  it('deleteTrigger DELETEs /:id/triggers/:triggerId and resolves void on 204', async () => {
    // apiFetch returns null for 204 No Content.
    mockApiFetch.mockResolvedValueOnce(null)

    await expect(deleteTrigger('wf-1', 't-1')).resolves.toBeUndefined()

    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/workflows/wf-1/triggers/t-1', {
      method: 'DELETE',
    })
  })
})
