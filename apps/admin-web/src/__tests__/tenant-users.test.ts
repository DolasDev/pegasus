// ---------------------------------------------------------------------------
// Unit tests for tenant-users API functions
// Verifies all functions delegate to adminFetch / adminFetchPaginated.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/api/client', () => ({
  adminFetch: vi.fn(),
  adminFetchPaginated: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number,
    ) {
      super(message)
    }
  },
}))

import { adminFetch, adminFetchPaginated } from '@/api/client'
import {
  listTenantUsers,
  inviteTenantUser,
  updateTenantUserRole,
  deactivateTenantUser,
  reactivateTenantUser,
} from '@/api/tenant-users'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenant-users API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listTenantUsers', () => {
    it('calls adminFetchPaginated with the correct path', async () => {
      const mockResult = { data: [], meta: { total: 0, count: 0, limit: 20, offset: 0 } }
      vi.mocked(adminFetchPaginated).mockResolvedValue(mockResult)

      const result = await listTenantUsers('tenant-123')

      expect(adminFetchPaginated).toHaveBeenCalledWith('/api/admin/tenants/tenant-123/users')
      expect(result).toEqual(mockResult)
    })
  })

  describe('inviteTenantUser', () => {
    it('calls adminFetch with POST and body', async () => {
      const user = { id: 'u1', email: 'test@example.com' }
      vi.mocked(adminFetch).mockResolvedValue(user)

      const result = await inviteTenantUser('tenant-123', {
        email: 'test@example.com',
        role: 'USER',
      })

      expect(adminFetch).toHaveBeenCalledWith('/api/admin/tenants/tenant-123/users', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com', role: 'USER' }),
      })
      expect(result).toEqual(user)
    })
  })

  describe('updateTenantUserRole', () => {
    it('calls adminFetch with PATCH and role body', async () => {
      const user = { id: 'u1', role: 'ADMIN' }
      vi.mocked(adminFetch).mockResolvedValue(user)

      const result = await updateTenantUserRole('tenant-123', 'user-456', 'ADMIN')

      expect(adminFetch).toHaveBeenCalledWith('/api/admin/tenants/tenant-123/users/user-456', {
        method: 'PATCH',
        body: JSON.stringify({ role: 'ADMIN' }),
      })
      expect(result).toEqual(user)
    })
  })

  describe('deactivateTenantUser', () => {
    it('calls adminFetch with DELETE', async () => {
      const user = { id: 'u1', status: 'DEACTIVATED' }
      vi.mocked(adminFetch).mockResolvedValue(user)

      const result = await deactivateTenantUser('tenant-123', 'user-456')

      expect(adminFetch).toHaveBeenCalledWith('/api/admin/tenants/tenant-123/users/user-456', {
        method: 'DELETE',
      })
      expect(result).toEqual(user)
    })
  })

  describe('reactivateTenantUser', () => {
    it('calls adminFetch with POST to reactivate path', async () => {
      const user = { id: 'u1', status: 'ACTIVE' }
      vi.mocked(adminFetch).mockResolvedValue(user)

      const result = await reactivateTenantUser('tenant-123', 'user-456')

      expect(adminFetch).toHaveBeenCalledWith(
        '/api/admin/tenants/tenant-123/users/user-456/reactivate',
        { method: 'POST' },
      )
      expect(result).toEqual(user)
    })
  })
})
