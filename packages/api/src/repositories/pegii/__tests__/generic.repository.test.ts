import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EntityConfig } from '../../../handlers/pegii/types'

vi.mock('../../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../column-utils', () => ({
  getColumns: vi.fn(),
  mapRow: vi.fn((row: Record<string, unknown>) => row),
}))

import { allIds, readById, readByCode, readList, write } from '../generic.repository'
import { getColumns } from '../column-utils'

const settingConfig: EntityConfig = {
  slug: 'settings',
  tableName: 'settings',
  idField: 'id',
  codeField: 'id',
  idType: 'integer',
  orderBy: 'ORDER BY name, id',
  searchKeywords: [
    { keyword: 'ID', toSql: (p) => `id=${p}` },
    { keyword: 'ACTIVE', toSql: () => `active='Y'` },
  ],
}

function createMockPool() {
  const mockRequest = {
    query: vi.fn(),
    input: vi.fn().mockReturnThis(),
    timeout: 0,
  }
  return {
    request: vi.fn(() => mockRequest),
    config: { database: 'testdb' },
    _mockRequest: mockRequest,
  }
}

describe('generic.repository', () => {
  let pool: ReturnType<typeof createMockPool>

  beforeEach(() => {
    pool = createMockPool()
    vi.clearAllMocks()
  })

  describe('allIds', () => {
    it('returns list of IDs from query', async () => {
      pool._mockRequest.query.mockResolvedValue({
        recordset: [{ id: 1 }, { id: 2 }, { id: 3 }],
      })

      const result = await allIds(pool as never, settingConfig, '')
      expect(result).toEqual([1, 2, 3])
      expect(pool._mockRequest.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT TOP 1000 id FROM settings'),
      )
    })

    it('applies search criteria', async () => {
      pool._mockRequest.query.mockResolvedValue({
        recordset: [{ id: 1 }],
      })

      await allIds(pool as never, settingConfig, 'ACTIVE')
      expect(pool._mockRequest.query).toHaveBeenCalledWith(expect.stringContaining("active='Y'"))
    })

    it('sets query timeout to 30s', async () => {
      pool._mockRequest.query.mockResolvedValue({ recordset: [] })
      await allIds(pool as never, settingConfig, '')
      expect(pool._mockRequest.timeout).toBe(30_000)
    })
  })

  describe('readById', () => {
    it('returns row when found', async () => {
      pool._mockRequest.query.mockResolvedValue({
        recordset: [{ id: 1, name: 'test', value: 'val' }],
      })

      const result = await readById(pool as never, settingConfig, 1)
      expect(result).toEqual({ id: 1, name: 'test', value: 'val' })
    })

    it('returns null when not found', async () => {
      pool._mockRequest.query.mockResolvedValue({ recordset: [] })

      const result = await readById(pool as never, settingConfig, 999)
      expect(result).toBeNull()
    })

    it('uses parameterized query with request.input', async () => {
      pool._mockRequest.query.mockResolvedValue({
        recordset: [{ id: 1 }],
      })

      await readById(pool as never, settingConfig, 1)
      expect(pool._mockRequest.input).toHaveBeenCalledWith('idParam', 1)
      expect(pool._mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('@idParam'))
    })
  })

  describe('readByCode', () => {
    it('returns row when found', async () => {
      pool._mockRequest.query.mockResolvedValue({
        recordset: [{ id: 1, name: 'test' }],
      })

      const result = await readByCode(pool as never, settingConfig, 'TEST')
      expect(result).toEqual({ id: 1, name: 'test' })
    })

    it('uses parameterized query instead of manual escaping', async () => {
      pool._mockRequest.query.mockResolvedValue({ recordset: [] })

      await readByCode(pool as never, settingConfig, "O'Brien")
      expect(pool._mockRequest.input).toHaveBeenCalledWith('codeParam', "O'Brien")
      expect(pool._mockRequest.query).toHaveBeenCalledWith(expect.stringContaining('@codeParam'))
    })
  })

  describe('readList', () => {
    it('returns array of rows', async () => {
      pool._mockRequest.query.mockResolvedValue({
        recordset: [
          { id: 1, name: 'a' },
          { id: 2, name: 'b' },
        ],
      })

      const result = await readList(pool as never, settingConfig, '')
      expect(result).toHaveLength(2)
    })

    it('sets query timeout to 30s', async () => {
      pool._mockRequest.query.mockResolvedValue({ recordset: [] })
      await readList(pool as never, settingConfig, '')
      expect(pool._mockRequest.timeout).toBe(30_000)
    })
  })

  describe('write', () => {
    it('inserts new record when no id provided', async () => {
      vi.mocked(getColumns).mockResolvedValue([
        { name: 'id', dataType: 'int', isNullable: false, maxLength: null },
        { name: 'name', dataType: 'varchar', isNullable: false, maxLength: 255 },
        { name: 'value', dataType: 'varchar', isNullable: true, maxLength: 255 },
      ])

      pool._mockRequest.query
        .mockResolvedValueOnce({ recordset: [{ id: 42 }] })
        .mockResolvedValueOnce({ recordset: [{ id: 42, name: 'test', value: 'val' }] })

      const result = await write(pool as never, settingConfig, { name: 'test', value: 'val' })
      expect(result).toEqual({ id: 42, name: 'test', value: 'val' })
    })

    it('updates existing record when id provided', async () => {
      vi.mocked(getColumns).mockResolvedValue([
        { name: 'id', dataType: 'int', isNullable: false, maxLength: null },
        { name: 'name', dataType: 'varchar', isNullable: false, maxLength: 255 },
      ])

      pool._mockRequest.query.mockResolvedValue({
        recordset: [{ id: 1, name: 'updated' }],
      })

      const result = await write(pool as never, settingConfig, { name: 'updated' }, 1)
      expect(result).toEqual({ id: 1, name: 'updated' })
      expect(pool._mockRequest.input).toHaveBeenCalled()
    })
  })
})
