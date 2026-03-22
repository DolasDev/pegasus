// ---------------------------------------------------------------------------
// Unit tests for the writeAuditLog helper (audit.ts)
//
// The Prisma transaction client is mocked via vi.hoisted so the same mock
// object is shared between the vi.mock factory and the test body.
//
// No real database is touched — tx.auditLog.create is a vi.fn().
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Hoisted mocks — shared across vi.mock factories and test bodies
// ---------------------------------------------------------------------------

const { mockTx } = vi.hoisted(() => ({
  mockTx: {
    auditLog: {
      create: vi.fn(),
    },
  },
}))

import { writeAuditLog } from './audit'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('writeAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.auditLog.create.mockResolvedValue({})
  })

  it('calls tx.auditLog.create with the correct data for a create event', async () => {
    const after = { id: 'tenant-1', name: 'Acme' }

    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'CREATE_TENANT',
      'TENANT',
      'tenant-1',
      null,
      after,
    )

    expect(mockTx.auditLog.create).toHaveBeenCalledOnce()
    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(call.data['adminSub']).toBe('admin-sub-123')
    expect(call.data['adminEmail']).toBe('admin@platform.com')
    expect(call.data['action']).toBe('CREATE_TENANT')
    expect(call.data['resourceType']).toBe('TENANT')
    expect(call.data['resourceId']).toBe('tenant-1')
    expect(call.data['before']).toBe(Prisma.JsonNull)
    expect(call.data['after']).toEqual(after)
  })

  it('calls tx.auditLog.create with the correct data for an update event', async () => {
    const before = { id: 'tenant-1', name: 'Old Name' }
    const after = { id: 'tenant-1', name: 'New Name' }

    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'UPDATE_TENANT',
      'TENANT',
      'tenant-1',
      before,
      after,
    )

    expect(mockTx.auditLog.create).toHaveBeenCalledOnce()
    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(call.data['action']).toBe('UPDATE_TENANT')
    expect(call.data['before']).toEqual(before)
    expect(call.data['after']).toEqual(after)
  })

  it('stores Prisma.JsonNull for null after field (hard delete)', async () => {
    const before = { id: 'tenant-1', name: 'Acme' }

    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'DELETE_TENANT',
      'TENANT',
      'tenant-1',
      before,
      null,
    )

    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(call.data['before']).toEqual(before)
    expect(call.data['after']).toBe(Prisma.JsonNull)
  })

  it('includes optional ipAddress when provided', async () => {
    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'SUSPEND_TENANT',
      'TENANT',
      'tenant-1',
      null,
      { status: 'SUSPENDED' },
      '1.2.3.4',
    )

    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(call.data['ipAddress']).toBe('1.2.3.4')
  })

  it('includes optional userAgent when provided', async () => {
    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'REACTIVATE_TENANT',
      'TENANT',
      'tenant-1',
      null,
      { status: 'ACTIVE' },
      undefined,
      'Mozilla/5.0 TestBrowser',
    )

    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(call.data['userAgent']).toBe('Mozilla/5.0 TestBrowser')
  })

  it('omits ipAddress key when not provided', async () => {
    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'CREATE_TENANT',
      'TENANT',
      'tenant-1',
      null,
      { id: 'tenant-1' },
    )

    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(Object.prototype.hasOwnProperty.call(call.data, 'ipAddress')).toBe(false)
  })

  it('omits userAgent key when not provided', async () => {
    await writeAuditLog(
      mockTx as unknown as Prisma.TransactionClient,
      'admin-sub-123',
      'admin@platform.com',
      'CREATE_TENANT',
      'TENANT',
      'tenant-1',
      null,
      { id: 'tenant-1' },
    )

    const call = mockTx.auditLog.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    expect(Object.prototype.hasOwnProperty.call(call.data, 'userAgent')).toBe(false)
  })

  it('propagates errors thrown by tx.auditLog.create', async () => {
    mockTx.auditLog.create.mockRejectedValue(new Error('DB connection lost'))

    await expect(
      writeAuditLog(
        mockTx as unknown as Prisma.TransactionClient,
        'admin-sub-123',
        'admin@platform.com',
        'CREATE_TENANT',
        'TENANT',
        'tenant-1',
        null,
        { id: 'tenant-1' },
      ),
    ).rejects.toThrow('DB connection lost')
  })
})
