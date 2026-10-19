// ---------------------------------------------------------------------------
// Settings → Users — the local-driver mapping (move chat access for local
// drivers). Covers the query gate on the page and the linker's pre-selection:
// it suggests the longhaul number only when that number is the same person,
// and the admin still has to save.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UsersPage, LocalDriverLinker } from './users'
import type { TenantUser } from '@/api/queries/users'
import type { LonghaulDriver } from '@/api/queries/longhaul-drivers'

let seen: Record<string, { enabled?: boolean }> = {}
let usersData: TenantUser[] = []
let permissions: string[] = []

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
          data: { permissions, roles: [], capabilities: { longhaul: true } },
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
    email: 'driver@example.com',
    cognitoSub: null,
    legacyWindowsUsername: null,
    roleNames: ['driver'],
    role: 'USER',
    status: 'ACTIVE',
    invitedAt: '2026-01-01T00:00:00.000Z',
    activatedAt: '2026-01-02T00:00:00.000Z',
    deactivatedAt: null,
    crewMemberId: null,
    crewMemberName: null,
    longhaulDriverId: null,
    localDriverEmployeeId: null,
    ssoOnly: false,
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

describe('UsersPage — local-drivers query gating', () => {
  beforeEach(() => {
    seen = {}
    usersData = [makeUser()]
  })

  it('requests local drivers for an admin who can edit users, once a driver exists', () => {
    permissions = ['user:list', 'user:update']
    renderPage()
    expect(seen['local-drivers']?.enabled).toBe(true)
  })

  it('does not request local drivers without user:update (the endpoint would 403)', () => {
    permissions = ['user:list']
    renderPage()
    expect(seen['local-drivers']?.enabled).toBe(false)
  })

  it('does not request local drivers when no user has the driver role', () => {
    permissions = ['user:list', 'user:update']
    usersData = [makeUser({ roleNames: ['sales'] })]
    renderPage()
    expect(seen['local-drivers']?.enabled).toBe(false)
  })
})

describe('LocalDriverLinker', () => {
  const longhaul: LonghaulDriver[] = [
    { driver_id: 134, driver_name: 'Smith, Pat', agent_code: null, active: 'Y', type: 'NW' },
    { driver_id: 500, driver_name: 'Godin, William', agent_code: null, active: 'Y', type: 'NW' },
  ]
  const local = [
    { employeeId: 134, name: 'SMITH, PAT' },
    { employeeId: 500, name: 'KENNEDY, BRENT' },
    { employeeId: 71, name: 'LEE, ANN' },
  ]

  function linker(user: TenantUser, onSave = vi.fn().mockResolvedValue(undefined)) {
    render(
      <LocalDriverLinker
        user={user}
        localDrivers={local}
        longhaulDrivers={longhaul}
        driversLoading={false}
        driversError={false}
        onSave={onSave}
      />,
    )
    return onSave
  }

  it('starts on the longhaul number when it is the same person, and saves only on confirm', async () => {
    const onSave = linker(makeUser({ longhaulDriverId: 134 }))
    expect(screen.getByText(/not linked/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect((screen.getByLabelText('Local driver') as HTMLSelectElement).value).toBe('134')
    expect(screen.getByText(/Suggested: same number and name/)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('Save local driver'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(134))
  })

  it('suggests nothing when the same number is a different person', () => {
    linker(makeUser({ longhaulDriverId: 500 }))
    fireEvent.click(screen.getByRole('button'))
    expect((screen.getByLabelText('Local driver') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByText(/Suggested/)).toBeNull()
  })

  it('shows and keeps an existing mapping', async () => {
    const onSave = linker(makeUser({ longhaulDriverId: 134, localDriverEmployeeId: 71 }))
    expect(screen.getByText('LEE, ANN')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    const select = screen.getByLabelText('Local driver') as HTMLSelectElement
    expect(select.value).toBe('71')
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByLabelText('Save local driver'))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
  })
})
