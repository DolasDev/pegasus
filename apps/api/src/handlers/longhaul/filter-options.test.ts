// ---------------------------------------------------------------------------
// Unit tests for the longhaul filter-options handler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'
import type { ConnectionPool } from 'mssql'
import type { Knex } from 'knex'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../repositories/longhaul/filter-options.repository', () => ({
  getFilterOptions: vi.fn(),
  getSavedFiltersForUser: vi.fn(),
  saveFilter: vi.fn(),
  setDefaultFilter: vi.fn(),
  deleteFilter: vi.fn(),
  getDefaultFilter: vi.fn(),
}))

import {
  getSavedFiltersForUser,
  getFilterOptions,
} from '../../repositories/longhaul/filter-options.repository'
import type * as FilterOptionsRepoModule from '../../repositories/longhaul/filter-options.repository'
import { filterOptionsRouter } from './filter-options'

const mockDb = {} as unknown as Knex

const USER_A = {
  code: 1,
  first_name: 'Alice',
  last_name: 'A',
  active: 'Y',
  win_username: 'alice',
}

function buildApp(user = USER_A) {
  const app = new Hono<OnPremEnv>()
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant')
    c.set('longhaulUser', user)
    c.set('longhaulDb', mockDb)
    c.set('db', {} as unknown as PrismaClient)
    c.set('mssqlPool', {} as unknown as ConnectionPool)
    c.set('apiClient', undefined)
    await next()
  })
  app.route('/', filterOptionsRouter)
  return app
}

type JsonBody = Record<string, unknown>
async function json(res: Response): Promise<JsonBody> {
  return res.json() as Promise<JsonBody>
}

// ---------------------------------------------------------------------------
// GET /filter-options
// ---------------------------------------------------------------------------

describe('GET /filter-options', () => {
  it('returns move type options', async () => {
    vi.mocked(getFilterOptions).mockResolvedValue({
      moveType: [{ value: 'H', label: 'Interstate' }],
    })
    const app = buildApp()
    const res = await app.request('/filter-options')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body['data']).toEqual({ moveType: [{ value: 'H', label: 'Interstate' }] })
  })
})

// ---------------------------------------------------------------------------
// GET /shipment-filters — self/public scoping
// ---------------------------------------------------------------------------

describe('GET /shipment-filters scoping', () => {
  beforeEach(() => {
    vi.mocked(getSavedFiltersForUser).mockReset()
  })

  it('defaults to type=self when no query param is supplied', async () => {
    vi.mocked(getSavedFiltersForUser).mockResolvedValue([])
    const app = buildApp()
    const res = await app.request('/shipment-filters')
    expect(res.status).toBe(200)
    expect(getSavedFiltersForUser).toHaveBeenCalledWith(mockDb, USER_A.code, 'self')
  })

  it('passes type=public through to the repository', async () => {
    vi.mocked(getSavedFiltersForUser).mockResolvedValue([])
    const app = buildApp()
    const res = await app.request('/shipment-filters?type=public')
    expect(res.status).toBe(200)
    expect(getSavedFiltersForUser).toHaveBeenCalledWith(mockDb, USER_A.code, 'public')
  })

  it('treats unknown type values as self (no leakage into public scope)', async () => {
    vi.mocked(getSavedFiltersForUser).mockResolvedValue([])
    const app = buildApp()
    const res = await app.request('/shipment-filters?type=everything')
    expect(res.status).toBe(200)
    expect(getSavedFiltersForUser).toHaveBeenCalledWith(mockDb, USER_A.code, 'self')
  })

  it('returns 403 when no longhaul user is on the context', async () => {
    vi.mocked(getSavedFiltersForUser).mockResolvedValue([])
    const app = new Hono<OnPremEnv>()
    app.use('*', async (c, next) => {
      c.set('tenantId', 'test-tenant')
      c.set('longhaulUser', undefined)
      c.set('longhaulDb', mockDb)
      c.set('db', {} as unknown as PrismaClient)
      c.set('mssqlPool', {} as unknown as ConnectionPool)
      c.set('apiClient', undefined)
      await next()
    })
    app.route('/', filterOptionsRouter)
    const res = await app.request('/shipment-filters')
    expect(res.status).toBe(403)
    expect(getSavedFiltersForUser).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Repository scoping — regression test for cross-user leakage
//
// Simulates a tiny dataset of saved filters owned by two users and verifies
// that the repository's where/andWhere chain produces the correct subset for
// each type. Uses a fake knex builder that records the chain and applies the
// constraints in-memory.
// ---------------------------------------------------------------------------

describe('getSavedFiltersForUser scoping (repository)', () => {
  // Use the unmocked implementation here.
  let realGetSavedFiltersForUser: typeof getSavedFiltersForUser

  beforeEach(async () => {
    vi.doUnmock('../../repositories/longhaul/filter-options.repository')
    const mod = (await vi.importActual(
      '../../repositories/longhaul/filter-options.repository',
    )) as typeof FilterOptionsRepoModule
    realGetSavedFiltersForUser = mod.getSavedFiltersForUser
  })

  type Filter = {
    filter_id: number
    name: string
    owner_code: number
    is_public: boolean
    query: string
  }

  function makeFakeDb(rows: Filter[]): Knex {
    // Records the chain of where clauses, then resolves with the matching subset.
    function builder() {
      const constraints: Array<(r: Filter) => boolean> = []
      const chain = {
        where(field: string, value: unknown) {
          constraints.push((r) => (r as unknown as Record<string, unknown>)[field] === value)
          return chain
        },
        andWhere(field: string, value: unknown) {
          constraints.push((r) => (r as unknown as Record<string, unknown>)[field] === value)
          return chain
        },
        orderBy() {
          return chain
        },
        select() {
          return chain
        },
        then(onResolve: (v: Filter[]) => unknown, onReject?: (e: unknown) => unknown) {
          try {
            const out = rows.filter((r) => constraints.every((c) => c(r)))
            return Promise.resolve(onResolve(out))
          } catch (err) {
            return onReject ? Promise.resolve(onReject(err)) : Promise.reject(err)
          }
        },
      }
      return chain
    }
    return ((_table: string) => builder()) as unknown as Knex
  }

  it('type=self returns only the requester’s private filters and never leaks others', async () => {
    const rows: Filter[] = [
      // A: one private, one public
      { filter_id: 1, name: 'A private', owner_code: 1, is_public: false, query: '{}' },
      { filter_id: 2, name: 'A public', owner_code: 1, is_public: true, query: '{}' },
      // B: one private, one public
      { filter_id: 3, name: 'B private', owner_code: 2, is_public: false, query: '{}' },
      { filter_id: 4, name: 'B public', owner_code: 2, is_public: true, query: '{}' },
    ]
    const db = makeFakeDb(rows)

    const result = await realGetSavedFiltersForUser(db, 1, 'self')
    const ids = result.map((r: Filter) => r.filter_id).sort()
    expect(ids).toEqual([1])
    // No public filter of A's, no private filter of B's, no public filter of B's.
    expect(ids).not.toContain(2)
    expect(ids).not.toContain(3)
    expect(ids).not.toContain(4)
  })

  it('type=public returns public filters regardless of owner, and never private ones', async () => {
    const rows: Filter[] = [
      { filter_id: 1, name: 'A private', owner_code: 1, is_public: false, query: '{}' },
      { filter_id: 2, name: 'A public', owner_code: 1, is_public: true, query: '{}' },
      { filter_id: 3, name: 'B private', owner_code: 2, is_public: false, query: '{}' },
      { filter_id: 4, name: 'B public', owner_code: 2, is_public: true, query: '{}' },
    ]
    const db = makeFakeDb(rows)

    const result = await realGetSavedFiltersForUser(db, 1, 'public')
    const ids = result.map((r: Filter) => r.filter_id).sort()
    expect(ids).toEqual([2, 4])
    expect(ids).not.toContain(1)
    expect(ids).not.toContain(3)
  })

  it('default scope is self (backward compat)', async () => {
    const rows: Filter[] = [
      { filter_id: 1, name: 'A private', owner_code: 1, is_public: false, query: '{}' },
      { filter_id: 3, name: 'B private', owner_code: 2, is_public: false, query: '{}' },
      { filter_id: 4, name: 'B public', owner_code: 2, is_public: true, query: '{}' },
    ]
    const db = makeFakeDb(rows)

    const result = await realGetSavedFiltersForUser(db, 1)
    expect(result.map((r: Filter) => r.filter_id)).toEqual([1])
  })

  it('never leaks user B’s private filter to user A in either scope', async () => {
    const bPrivate: Filter = {
      filter_id: 99,
      name: 'B secret',
      owner_code: 2,
      is_public: false,
      query: '{}',
    }
    const rows: Filter[] = [
      { filter_id: 10, name: 'A private', owner_code: 1, is_public: false, query: '{}' },
      bPrivate,
    ]

    const self = await realGetSavedFiltersForUser(makeFakeDb(rows), 1, 'self')
    const pub = await realGetSavedFiltersForUser(makeFakeDb(rows), 1, 'public')
    expect(self.find((r: Filter) => r.filter_id === 99)).toBeUndefined()
    expect(pub.find((r: Filter) => r.filter_id === 99)).toBeUndefined()
  })
})
