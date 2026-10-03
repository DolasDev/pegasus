import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClose = vi.hoisted(() => vi.fn())
vi.mock('./db', () => ({ db: {} }))
vi.mock('./lib/usage/statement-close', () => ({ closeUsageStatements: mockClose }))

import { handler } from './lambda-usage-statement-close'

beforeEach(() => mockClose.mockReset())

describe('usage statement close lambda', () => {
  it('completes when every tenant closed', async () => {
    mockClose.mockResolvedValue({
      tenantsChecked: 2,
      statementsWritten: [{ tenantId: 't1', periodMonth: '2026-09' }],
      failures: [],
    })
    await expect(handler()).resolves.toBeUndefined()
  })

  it('throws when any tenant failed, so the Lambda Errors alarm pages', async () => {
    mockClose.mockResolvedValue({
      tenantsChecked: 2,
      statementsWritten: [],
      failures: [{ tenantId: 't2', error: 'boom' }],
    })
    await expect(handler()).rejects.toThrow(/1 tenant/)
  })
})
