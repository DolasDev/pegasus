// ---------------------------------------------------------------------------
// UsersPage — longhaul-driver query gating
//
// Boundary: route-level page that fans out several TanStack Query calls. The
// one under test is `longhaul-drivers`, which hits
// GET /api/v1/onprem/longhaul/drivers. That endpoint answers 422
// MSSQL_NOT_CONFIGURED permanently on a tenant with no legacy MSSQL, and an
// errored query caches no data — so it never goes stale-free and refetches on
// every mount and window focus. The page must therefore only ask for the list
// when something actually renders it: a non-deactivated `driver`-role user.
//
// Strategy: mock useQuery and capture the options it receives per query key,
// so we can assert on `enabled` directly (the driver-planning.index.test.tsx
// pattern). Mutations keep their real hooks under a real QueryClientProvider.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UsersPage } from './users'
import type { TenantUser } from '@/api/queries/users'

// apiFetch is mocked so the mutations under test assert on the URL they call
// rather than on a network stub.
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/api/client')
  return { ...actual, apiFetch: mockApiFetch }
})

// Captured useQuery options, keyed by the head of the query key.
let seen: Record<string, { enabled?: boolean }> = {}
let usersData: TenantUser[] = []
let permissions: string[] = []
// `undefined` → omit the capabilities field entirely (rollout-skew / fail-open).
let capabilities: { longhaul?: boolean } | undefined

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
      const head = String(options.queryKey?.[0])
      seen[head] = { enabled: options.enabled }

      if (head === 'me') {
        return {
          data: { permissions, roles: [], ...(capabilities ? { capabilities } : {}) },
          isLoading: false,
          isError: false,
        }
      }
      if (head === 'users' && options.queryKey?.[1] === 'list') {
        return { data: usersData, isLoading: false, isError: false }
      }
      return { data: undefined, isLoading: false, isError: false }
    },
  }
})

function makeUser(overrides?: Partial<TenantUser>): TenantUser {
  return {
    id: 'u1',
    email: 'someone@example.com',
    cognitoSub: null,
    legacyWindowsUsername: null,
    roleNames: ['tenant_admin'],
    role: 'ADMIN',
    status: 'ACTIVE',
    invitedAt: '2026-01-01T00:00:00.000Z',
    activatedAt: '2026-01-02T00:00:00.000Z',
    deactivatedAt: null,
    crewMemberId: null,
    crewMemberName: null,
    longhaulDriverId: null,
    ...overrides,
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <UsersPage />
    </QueryClientProvider>,
  )
}

describe('UsersPage — longhaul-drivers query gating', () => {
  beforeEach(() => {
    seen = {}
    permissions = ['user:list']
    usersData = []
    capabilities = { longhaul: true }
  })

  it('does not request longhaul drivers when no user has the driver role', () => {
    usersData = [makeUser({ roleNames: ['tenant_admin'] })]
    renderPage()
    expect(seen['longhaul-drivers']?.enabled).toBe(false)
  })

  it('requests longhaul drivers once a driver-role user exists', () => {
    usersData = [makeUser({ id: 'u2', roleNames: ['driver'] })]
    renderPage()
    expect(seen['longhaul-drivers']?.enabled).toBe(true)
  })

  it('does not request longhaul drivers when the only driver is deactivated', () => {
    // Mirrors UserRow: the linker renders for `!isDeactivated && isDriver`.
    usersData = [makeUser({ id: 'u3', roleNames: ['driver'], status: 'DEACTIVATED' })]
    renderPage()
    expect(seen['longhaul-drivers']?.enabled).toBe(false)
  })

  it('does not request longhaul drivers without user:list, even with drivers present', () => {
    permissions = []
    usersData = [makeUser({ id: 'u4', roleNames: ['driver'] })]
    renderPage()
    expect(seen['longhaul-drivers']?.enabled).toBe(false)
  })

  it('does not request longhaul drivers when the tenant lacks the longhaul capability', () => {
    // Even with an active driver user, a non-longhaul tenant has nothing to map
    // to — the capability gate suppresses the request entirely.
    capabilities = { longhaul: false }
    usersData = [makeUser({ id: 'u5', roleNames: ['driver'] })]
    renderPage()
    expect(seen['longhaul-drivers']?.enabled).toBe(false)
  })

  it('requests longhaul drivers when the capability flag is absent (fail-open)', () => {
    // Older API during a rolled deploy omits `capabilities`; fail open so a real
    // longhaul tenant is not transiently degraded.
    capabilities = undefined
    usersData = [makeUser({ id: 'u6', roleNames: ['driver'] })]
    renderPage()
    expect(seen['longhaul-drivers']?.enabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Resend invite — the way out of an expired temporary password
//
// Cognito temp passwords expire after 7 days. A PENDING user past that window
// cannot sign in, and the admin's other two levers do not apply: POST /invite
// 409s (the TenantUser row exists) and "Reset password" is ACTIVE-only. This
// button is the only path, so its visibility rules matter — showing it on an
// ACTIVE user would re-invite someone who already has a working password.
// ---------------------------------------------------------------------------

describe('UsersPage — resend invite', () => {
  beforeEach(() => {
    seen = {}
    permissions = ['user:list', 'user:invite', 'user:update']
    usersData = []
    capabilities = { longhaul: false }
    mockApiFetch.mockReset()
    mockApiFetch.mockResolvedValue({})
  })

  it('offers Resend invite on a PENDING user', () => {
    usersData = [makeUser({ id: 'p1', status: 'PENDING', activatedAt: null })]
    renderPage()
    expect(screen.getByRole('button', { name: /resend invite/i })).toBeTruthy()
  })

  it('does not offer it on an ACTIVE user (they get Reset password instead)', () => {
    usersData = [makeUser({ id: 'a1', status: 'ACTIVE' })]
    renderPage()
    expect(screen.queryByRole('button', { name: /resend invite/i })).toBeNull()
    expect(screen.getByRole('button', { name: /reset password/i })).toBeTruthy()
  })

  it('does not offer it on a DEACTIVATED user (reactivate first)', () => {
    usersData = [
      makeUser({ id: 'd1', status: 'DEACTIVATED', deactivatedAt: '2026-02-01T00:00:00.000Z' }),
    ]
    renderPage()
    expect(screen.queryByRole('button', { name: /resend invite/i })).toBeNull()
  })

  it('does not offer it without user:invite', () => {
    permissions = ['user:list', 'user:update']
    usersData = [makeUser({ id: 'p2', status: 'PENDING', activatedAt: null })]
    renderPage()
    expect(screen.queryByRole('button', { name: /resend invite/i })).toBeNull()
  })

  it('posts to the resend-invite endpoint and confirms once it succeeds', async () => {
    usersData = [makeUser({ id: 'p3', status: 'PENDING', activatedAt: null })]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }))
    fireEvent.click(screen.getByRole('button', { name: /resend invitation$/i }))

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/users/p3/resend-invite', {
        method: 'POST',
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/invitation re-sent/i)).toBeTruthy()
    })
  })

  it('keeps the panel open and surfaces the error when the call fails', async () => {
    usersData = [makeUser({ id: 'p4', status: 'PENDING', activatedAt: null })]
    mockApiFetch.mockRejectedValue(new Error('Failed to resend the invitation. Please try again.'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }))
    fireEvent.click(screen.getByRole('button', { name: /resend invitation$/i }))

    await waitFor(() => {
      expect(screen.getByText(/failed to resend the invitation/i)).toBeTruthy()
    })
    // Still on the confirm step, so the admin can retry without reopening.
    expect(screen.getByRole('button', { name: /resend invitation$/i })).toBeTruthy()
  })
})
