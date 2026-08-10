// ---------------------------------------------------------------------------
// Cache-invalidation tests for the secret/config mutations.
//
// The requirements summaries resolve each declared key present/missing against
// this store, so a create or delete has to invalidate them too — otherwise the
// Configs page keeps listing a key you just added as "declared but not set".
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/workflow-secrets-configs', () => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn().mockResolvedValue({}),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  listConfigs: vi.fn(),
  createConfig: vi.fn().mockResolvedValue({}),
  upsertConfig: vi.fn().mockResolvedValue({}),
  deleteConfig: vi.fn().mockResolvedValue(undefined),
}))

import {
  useCreateSecret,
  useDeleteSecret,
  useCreateConfig,
  useUpsertConfig,
  useDeleteConfig,
} from '../api/queries/workflow-secrets-configs'

let client: QueryClient
let invalidated: unknown[][]

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidated = []
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push([...(filters?.queryKey ?? [])])
    return Promise.resolve()
  })
})

/** Did anything invalidate the workflow AND integration requirement summaries? */
function invalidatedBothSummaries(): boolean {
  const keys = invalidated.map((k) => JSON.stringify(k))
  return (
    keys.includes(JSON.stringify(['workflows', 'requirements-summary'])) &&
    keys.includes(JSON.stringify(['integrations', 'requirements-summary']))
  )
}

describe('secret/config mutations invalidate the requirement summaries', () => {
  it('does so on secret create', async () => {
    const { result } = renderHook(() => useCreateSecret(), { wrapper })
    act(() => result.current.mutate({ key: 'K', value: 'v' }))
    await waitFor(() => expect(invalidatedBothSummaries()).toBe(true))
  })

  it('does so on secret delete', async () => {
    const { result } = renderHook(() => useDeleteSecret(), { wrapper })
    act(() => result.current.mutate({ key: 'K', group: 'global' }))
    await waitFor(() => expect(invalidatedBothSummaries()).toBe(true))
  })

  it('does so on config create', async () => {
    const { result } = renderHook(() => useCreateConfig(), { wrapper })
    act(() => result.current.mutate({ key: 'K', value: 'v' }))
    await waitFor(() => expect(invalidatedBothSummaries()).toBe(true))
  })

  it('does so on config delete', async () => {
    const { result } = renderHook(() => useDeleteConfig(), { wrapper })
    act(() => result.current.mutate({ key: 'K', group: 'global' }))
    await waitFor(() => expect(invalidatedBothSummaries()).toBe(true))
  })

  it('skips them on config upsert — a value change never changes presence', async () => {
    const { result } = renderHook(() => useUpsertConfig(), { wrapper })
    act(() => result.current.mutate({ key: 'K', data: { value: 'v2' } }))
    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0))
    expect(invalidatedBothSummaries()).toBe(false)
  })
})
