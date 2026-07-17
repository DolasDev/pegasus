// ---------------------------------------------------------------------------
// usePermissions — capability helper.
//
// Focus: `hasCapability` fail-open semantics. The Cedar permission tests are
// covered where those gates are consumed; here we pin the capability primitive
// so its rollout-safe default can't silently regress.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { MePermissions } from './permissions'

// Drive usePermissions by stubbing the underlying query return per-test.
let queryData: MePermissions | undefined
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: () => ({ data: queryData, isLoading: false }),
  }
})

import { usePermissions } from './permissions'

function setData(data: MePermissions | undefined) {
  queryData = data
}

describe('usePermissions().hasCapability', () => {
  it('is true when the capability is explicitly true', () => {
    setData({ roles: [], permissions: [], capabilities: { longhaul: true } })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.hasCapability('longhaul')).toBe(true)
  })

  it('is false only when the capability is explicitly false', () => {
    setData({ roles: [], permissions: [], capabilities: { longhaul: false } })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.hasCapability('longhaul')).toBe(false)
  })

  it('fails open when the capabilities object is absent', () => {
    setData({ roles: [], permissions: [] })
    const { result } = renderHook(() => usePermissions())
    expect(result.current.hasCapability('longhaul')).toBe(true)
  })

  it('fails open when the query has not resolved yet', () => {
    setData(undefined)
    const { result } = renderHook(() => usePermissions())
    expect(result.current.hasCapability('longhaul')).toBe(true)
  })
})
