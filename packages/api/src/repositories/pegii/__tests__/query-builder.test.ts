import { describe, it, expect } from 'vitest'
import { queryGiven, queryGivenSubset, createWhereGivenFn } from '../query-builder'
import type { SearchKeyword } from '../../../handlers/pegii/types'

const branchKeywords: SearchKeyword[] = [
  { keyword: 'ID', toSql: (p) => `id=${p}` },
  { keyword: 'CODE', toSql: (p) => `branch_id='${p}'` },
  { keyword: 'ACTIVE', toSql: () => `branch_active='Y'` },
  { keyword: 'NOTACTIVE', toSql: () => `branch_active='N'` },
]

const whereGivenFn = createWhereGivenFn(branchKeywords)

describe('queryGiven', () => {
  it('builds basic SELECT TOP 1000 query with no criteria', () => {
    const result = queryGiven('branches', '*', '', whereGivenFn)
    expect(result.sql).toBe('SELECT TOP 1000 * FROM branches')
    expect(result.params).toEqual({})
  })

  it('builds query with WHERE clause from keywords', () => {
    const result = queryGiven('branches', '*', 'ACTIVE', whereGivenFn)
    expect(result.sql).toBe("SELECT TOP 1000 * FROM branches WHERE (branch_active='Y')")
  })

  it('builds query with ORDER BY', () => {
    const result = queryGiven('branches', '*', '', whereGivenFn, 'ORDER BY branch_name')
    expect(result.sql).toBe('SELECT TOP 1000 * FROM branches ORDER BY branch_name')
  })

  it('builds query with both WHERE and ORDER BY', () => {
    const result = queryGiven(
      'branches',
      'id, branch_name',
      'ACTIVE',
      whereGivenFn,
      'ORDER BY branch_name',
    )
    expect(result.sql).toBe(
      "SELECT TOP 1000 id, branch_name FROM branches WHERE (branch_active='Y') ORDER BY branch_name",
    )
  })

  it('handles SQL(...) embedded criteria', () => {
    const result = queryGiven('branches', '*', "SQL(WHERE branch_id='ABC')", whereGivenFn)
    expect(result.sql).toBe("SELECT TOP 1000 * FROM branches WHERE branch_id='ABC'")
  })

  it('combines keyword criteria with SQL(...) block', () => {
    const result = queryGiven('branches', '*', "ACTIVE SQL(WHERE branch_id='ABC')", whereGivenFn)
    expect(result.sql).toContain("branch_active='Y'")
    expect(result.sql).toContain("branch_id='ABC'")
    expect(result.sql).toContain('AND')
  })

  it('handles multiple keywords', () => {
    const result = queryGiven('branches', 'id', 'ID(42) ACTIVE', whereGivenFn)
    expect(result.sql).toBe(
      "SELECT TOP 1000 id FROM branches WHERE (id=42) AND (branch_active='Y')",
    )
  })

  it('matches VB.NET output: Branch AllIds with ACTIVE', () => {
    const result = queryGiven('branches', 'id', 'ACTIVE', whereGivenFn, ' ORDER BY branch_name')
    expect(result.sql).toBe(
      "SELECT TOP 1000 id FROM branches WHERE (branch_active='Y') ORDER BY branch_name",
    )
  })

  it('matches VB.NET output: Branch ReadList with no criteria', () => {
    const result = queryGiven('branches', '*', '', whereGivenFn, ' ORDER BY branch_name')
    expect(result.sql).toBe('SELECT TOP 1000 * FROM branches ORDER BY branch_name')
  })
})

describe('queryGivenSubset', () => {
  it('combines subset and search criteria', () => {
    const result = queryGivenSubset('branches', '*', 'ACTIVE', 'ID(42)', whereGivenFn)
    expect(result.sql).toContain("branch_active='Y'")
    expect(result.sql).toContain('id=42')
    expect(result.sql).toContain('WHERE')
  })

  it('handles empty subset', () => {
    const result = queryGivenSubset('branches', '*', '', 'ACTIVE', whereGivenFn)
    expect(result.sql).toBe("SELECT TOP 1000 * FROM branches WHERE (branch_active='Y')")
  })

  it('handles empty search criteria', () => {
    const result = queryGivenSubset('branches', '*', 'ACTIVE', '', whereGivenFn)
    expect(result.sql).toBe("SELECT TOP 1000 * FROM branches WHERE (branch_active='Y')")
  })

  it('handles both empty', () => {
    const result = queryGivenSubset('branches', '*', '', '', whereGivenFn)
    expect(result.sql).toBe('SELECT TOP 1000 * FROM branches')
  })
})
