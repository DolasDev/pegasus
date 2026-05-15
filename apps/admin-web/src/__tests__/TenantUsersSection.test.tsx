import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TenantUsersSection } from '../components/TenantUsersSection'
import { ApiError } from '../api/client'
import type { RoleOption, TenantUser } from '../api/tenant-users'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/api/tenant-users', () => ({
  listTenantUsers: vi.fn(),
  listTenantUserRoleOptions: vi.fn(),
  inviteTenantUser: vi.fn(),
  updateTenantUserRole: vi.fn(),
  deactivateTenantUser: vi.fn(),
  reactivateTenantUser: vi.fn(),
}))

import {
  listTenantUsers,
  listTenantUserRoleOptions,
  inviteTenantUser,
  updateTenantUserRole,
  deactivateTenantUser,
} from '@/api/tenant-users'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_OPTIONS: RoleOption[] = [
  { name: 'tenant_admin', label: 'Admin', description: 'Full access.' },
  { name: 'viewer', label: 'Viewer', description: 'Read-only baseline.' },
  { name: 'local_dispatch', label: 'Local Dispatch', description: 'Local dispatch ops.' },
  { name: 'sales', label: 'Sales', description: 'Quote authoring.' },
  { name: 'accountant', label: 'Accountant', description: 'Invoice control.' },
  { name: 'warehouse', label: 'Warehouse', description: 'Storage and crew handoff.' },
  { name: 'coordinator', label: 'Coordinator', description: 'Broad operational authoring.' },
]

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
}

function renderSection(tenantId = 'tenant-1') {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TenantUsersSection tenantId={tenantId} />
    </QueryClientProvider>,
  )
}

function makeUser(overrides: Partial<TenantUser> = {}): TenantUser {
  return {
    id: 'user-1',
    email: 'user@acme.com',
    cognitoSub: null,
    roleNames: ['viewer'],
    role: 'USER',
    status: 'PENDING',
    invitedAt: '2024-01-15T12:00:00.000Z',
    activatedAt: null,
    deactivatedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantUsersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listTenantUserRoleOptions).mockResolvedValue(ROLE_OPTIONS)
  })

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('shows a loading state while the query is in flight', () => {
      vi.mocked(listTenantUsers).mockReturnValue(new Promise(() => {}))
      renderSection()
      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('renders a row per user with email, role badge, and status badge', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ email: 'user@acme.com', role: 'USER', status: 'ACTIVE' })],
        meta: { count: 1 },
      })
      renderSection()
      await screen.findByText('user@acme.com')
      expect(screen.getByText('Viewer')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('renders multiple role chips when a user has more than one role', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [
          makeUser({
            email: 'multi@acme.com',
            status: 'ACTIVE',
            roleNames: ['local_dispatch', 'sales'],
          }),
        ],
        meta: { count: 1 },
      })
      renderSection()
      await screen.findByText('multi@acme.com')
      expect(screen.getByText('Local Dispatch')).toBeInTheDocument()
      expect(screen.getByText('Sales')).toBeInTheDocument()
    })

    it('shows empty state when the list is empty', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({ data: [], meta: { count: 0 } })
      renderSection()
      await screen.findByText(/no users/i)
    })
  })

  // ── Invite form ───────────────────────────────────────────────────────────

  describe('Invite form', () => {
    it('"Invite user" button reveals the invite form', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({ data: [], meta: { count: 0 } })
      renderSection()
      await screen.findByText(/no users/i)

      fireEvent.click(screen.getByRole('button', { name: /invite user/i }))
      expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument()
    })

    it('submit calls inviteTenantUser with the picked roleNames', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({ data: [], meta: { count: 0 } })
      vi.mocked(inviteTenantUser).mockResolvedValue(
        makeUser({ email: 'new@acme.com', roleNames: ['local_dispatch'], role: 'USER' }),
      )
      renderSection()
      await screen.findByText(/no users/i)

      fireEvent.click(screen.getByRole('button', { name: /invite user/i }))
      // Wait for the role-options query to resolve and checkboxes to render.
      await screen.findByLabelText(/local dispatch/i)
      fireEvent.change(screen.getByPlaceholderText(/email/i), {
        target: { value: 'new@acme.com' },
      })
      // Default selection is viewer — uncheck it and pick local_dispatch.
      fireEvent.click(screen.getByLabelText(/viewer/i))
      fireEvent.click(screen.getByLabelText(/local dispatch/i))
      fireEvent.click(screen.getByRole('button', { name: /^invite$/i }))

      await waitFor(() => {
        expect(vi.mocked(inviteTenantUser)).toHaveBeenCalledWith('tenant-1', {
          email: 'new@acme.com',
          roleNames: ['local_dispatch'],
        })
      })
    })

    it('shows an inline error when inviteTenantUser rejects', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({ data: [], meta: { count: 0 } })
      vi.mocked(inviteTenantUser).mockRejectedValue(
        new ApiError('Email already in roster', 'CONFLICT', 409),
      )
      renderSection()
      await screen.findByText(/no users/i)

      fireEvent.click(screen.getByRole('button', { name: /invite user/i }))
      fireEvent.change(screen.getByPlaceholderText(/email/i), {
        target: { value: 'existing@acme.com' },
      })
      fireEvent.click(screen.getByRole('button', { name: /^invite$/i }))

      await screen.findByText(/email already in roster/i)
    })
  })

  // ── Manage roles ──────────────────────────────────────────────────────────

  describe('Manage roles', () => {
    it('opens the editor and saves a role swap from viewer → local_dispatch', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [
          makeUser({
            id: 'user-1',
            status: 'ACTIVE',
            roleNames: ['viewer'],
          }),
        ],
        meta: { count: 1 },
      })
      vi.mocked(updateTenantUserRole).mockResolvedValue(
        makeUser({ id: 'user-1', roleNames: ['local_dispatch'] }),
      )
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /manage roles/i }))
      await screen.findByLabelText(/local dispatch/i)
      fireEvent.click(screen.getByLabelText(/viewer/i)) // uncheck
      fireEvent.click(screen.getByLabelText(/local dispatch/i))
      fireEvent.click(screen.getByRole('button', { name: /save roles/i }))

      await waitFor(() => {
        expect(vi.mocked(updateTenantUserRole)).toHaveBeenCalledWith('tenant-1', 'user-1', [
          'local_dispatch',
        ])
      })
    })

    it('refuses client-side when the only active admin tries to drop tenant_admin', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [
          makeUser({
            id: 'admin-1',
            status: 'ACTIVE',
            roleNames: ['tenant_admin'],
            role: 'ADMIN',
          }),
        ],
        meta: { count: 1 },
      })
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /manage roles/i }))
      const adminCheckbox = await screen.findByRole('checkbox', { name: /^admin/i })
      fireEvent.click(adminCheckbox) // uncheck tenant_admin

      // Inline guard message appears, save button disabled, no API call fired.
      await screen.findByText(/cannot remove the last administrator/i)
      expect(screen.getByRole('button', { name: /save roles/i })).toBeDisabled()
      expect(vi.mocked(updateTenantUserRole)).not.toHaveBeenCalled()
    })
  })

  // ── Deactivate ────────────────────────────────────────────────────────────

  describe('Deactivate', () => {
    it('"Deactivate" button calls deactivateTenantUser for the correct user', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ id: 'user-1' })],
        meta: { count: 1 },
      })
      vi.mocked(deactivateTenantUser).mockResolvedValue(
        makeUser({ id: 'user-1', status: 'DEACTIVATED' }),
      )
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /deactivate/i }))
      await waitFor(() => {
        expect(vi.mocked(deactivateTenantUser)).toHaveBeenCalledWith('tenant-1', 'user-1')
      })
    })

    it('shows reactivate instead of deactivate for already-deactivated users', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ status: 'DEACTIVATED' })],
        meta: { count: 1 },
      })
      renderSection()
      await screen.findByText('user@acme.com')

      expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull()
      expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument()
    })

    it('shows an inline error when deactivateTenantUser rejects with LAST_ADMIN', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ role: 'ADMIN' })],
        meta: { count: 1 },
      })
      vi.mocked(deactivateTenantUser).mockRejectedValue(
        new ApiError('Cannot deactivate the last administrator.', 'LAST_ADMIN', 422),
      )
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /deactivate/i }))
      await screen.findByText(/cannot deactivate the last administrator/i)
    })
  })
})
