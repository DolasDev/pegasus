import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TenantUsersSection } from '../components/TenantUsersSection'
import { ApiError } from '../api/client'
import type { TenantUser } from '../api/tenant-users'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/api/tenant-users', () => ({
  listTenantUsers: vi.fn(),
  inviteTenantUser: vi.fn(),
  updateTenantUserRole: vi.fn(),
  deactivateTenantUser: vi.fn(),
}))

import {
  listTenantUsers,
  inviteTenantUser,
  updateTenantUserRole,
  deactivateTenantUser,
} from '@/api/tenant-users'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      expect(screen.getByText('User')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
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

    it('submit calls inviteTenantUser with the entered email and selected role', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({ data: [], meta: { count: 0 } })
      vi.mocked(inviteTenantUser).mockResolvedValue(
        makeUser({ email: 'new@acme.com', role: 'ADMIN' }),
      )
      renderSection()
      await screen.findByText(/no users/i)

      fireEvent.click(screen.getByRole('button', { name: /invite user/i }))
      fireEvent.change(screen.getByPlaceholderText(/email/i), {
        target: { value: 'new@acme.com' },
      })
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ADMIN' } })
      fireEvent.click(screen.getByRole('button', { name: /^invite$/i }))

      await waitFor(() => {
        expect(vi.mocked(inviteTenantUser)).toHaveBeenCalledWith('tenant-1', {
          email: 'new@acme.com',
          role: 'ADMIN',
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

    it('hides the form and refetches the list on success', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({ data: [], meta: { count: 0 } })
      vi.mocked(inviteTenantUser).mockResolvedValue(makeUser())
      renderSection()
      await screen.findByText(/no users/i)

      fireEvent.click(screen.getByRole('button', { name: /invite user/i }))
      const emailInput = screen.getByPlaceholderText(/email/i)
      fireEvent.change(emailInput, { target: { value: 'new@acme.com' } })
      fireEvent.click(screen.getByRole('button', { name: /^invite$/i }))

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/email/i)).not.toBeInTheDocument()
      })
      expect(vi.mocked(listTenantUsers)).toHaveBeenCalledTimes(2)
    })
  })

  // ── Role toggle ───────────────────────────────────────────────────────────

  describe('Role toggle', () => {
    it('"Make admin" button calls updateTenantUserRole with ADMIN', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ id: 'user-1', role: 'USER' })],
        meta: { count: 1 },
      })
      vi.mocked(updateTenantUserRole).mockResolvedValue(makeUser({ role: 'ADMIN' }))
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /make admin/i }))
      await waitFor(() => {
        expect(vi.mocked(updateTenantUserRole)).toHaveBeenCalledWith('tenant-1', 'user-1', 'ADMIN')
      })
    })

    it('"Make user" button calls updateTenantUserRole with USER', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ id: 'admin-1', role: 'ADMIN' })],
        meta: { count: 1 },
      })
      vi.mocked(updateTenantUserRole).mockResolvedValue(makeUser({ id: 'admin-1', role: 'USER' }))
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /make user/i }))
      await waitFor(() => {
        expect(vi.mocked(updateTenantUserRole)).toHaveBeenCalledWith('tenant-1', 'admin-1', 'USER')
      })
    })

    it('shows an inline error when updateTenantUserRole rejects', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ role: 'USER' })],
        meta: { count: 1 },
      })
      vi.mocked(updateTenantUserRole).mockRejectedValue(
        new ApiError('Failed to update role', 'INTERNAL_ERROR', 500),
      )
      renderSection()
      await screen.findByText('user@acme.com')

      fireEvent.click(screen.getByRole('button', { name: /make admin/i }))
      await screen.findByText(/failed to update role/i)
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

    it('deactivate button is disabled for already-deactivated users', async () => {
      vi.mocked(listTenantUsers).mockResolvedValue({
        data: [makeUser({ status: 'DEACTIVATED' })],
        meta: { count: 1 },
      })
      renderSection()
      await screen.findByText('user@acme.com')

      expect(screen.getByRole('button', { name: /deactivate/i })).toBeDisabled()
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
