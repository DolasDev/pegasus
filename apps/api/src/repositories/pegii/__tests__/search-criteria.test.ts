import { describe, it, expect } from 'vitest'
import {
  withTranslatedDates,
  parseSearchWords,
  parseKeywordAndParam,
  whereGiven,
} from '../search-criteria'
import type { SearchKeyword } from '../../../handlers/pegii/types'

describe('withTranslatedDates', () => {
  it('replaces (TODAY) with current date in MM/dd/yyyy format', () => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const yyyy = now.getFullYear()
    const expected = `(${mm}/${dd}/${yyyy})`

    expect(withTranslatedDates('(TODAY)')).toBe(expected)
  })

  it('replaces (YESTERDAY) with yesterday date', () => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    now.setDate(now.getDate() - 1)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const yyyy = now.getFullYear()
    const expected = `(${mm}/${dd}/${yyyy})`

    expect(withTranslatedDates('(YESTERDAY)')).toBe(expected)
  })

  it('replaces (TODAY+5) with date 5 days from now', () => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    now.setDate(now.getDate() + 5)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const yyyy = now.getFullYear()
    const expected = `(${mm}/${dd}/${yyyy})`

    expect(withTranslatedDates('(TODAY+5)')).toBe(expected)
  })

  it('replaces (TODAY-3) with date 3 days ago', () => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    now.setDate(now.getDate() - 3)
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const yyyy = now.getFullYear()
    const expected = `(${mm}/${dd}/${yyyy})`

    expect(withTranslatedDates('(TODAY-3)')).toBe(expected)
  })

  it('replaces date range (TODAY,TODAY+5)', () => {
    const result = withTranslatedDates('(TODAY,TODAY+5)')
    expect(result).not.toContain('TODAY')
    expect(result).toMatch(/^\(\d{2}\/\d{2}\/\d{4},\d{2}\/\d{2}\/\d{4}\)$/)
  })

  it('returns input unchanged if no date keywords', () => {
    expect(withTranslatedDates('some text')).toBe('some text')
  })
})

describe('parseSearchWords', () => {
  it('splits space-delimited words', () => {
    expect(parseSearchWords('ID(123) ACTIVE')).toEqual(['ID(123)', 'ACTIVE'])
  })

  it('respects quoted strings', () => {
    expect(parseSearchWords("NAME('JOHN DOE')")).toEqual(["NAME('JOHN DOE')"])
  })

  it('handles empty input', () => {
    expect(parseSearchWords('')).toEqual([])
    expect(parseSearchWords('   ')).toEqual([])
  })
})

describe('parseKeywordAndParam', () => {
  it('extracts keyword and param from KEYWORD(param)', () => {
    expect(parseKeywordAndParam('ID(123)')).toEqual({ keyword: 'ID', param: '123' })
  })

  it('handles keyword without param', () => {
    expect(parseKeywordAndParam('ACTIVE')).toEqual({ keyword: 'ACTIVE', param: '' })
  })

  it('handles keyword with empty parens', () => {
    expect(parseKeywordAndParam('ACTIVE()')).toEqual({ keyword: 'ACTIVE', param: '' })
  })

  it('strips surrounding quotes from param', () => {
    expect(parseKeywordAndParam("NAME('ABC')")).toEqual({ keyword: 'NAME', param: 'ABC' })
  })
})

describe('whereGiven', () => {
  const branchKeywords: SearchKeyword[] = [
    { keyword: 'ID', toSql: (p) => `id=${p}` },
    { keyword: 'CODE', toSql: (p) => `branch_id='${p}'` },
    { keyword: 'BRANCHID', toSql: (p) => `branch_id='${p}'` },
    { keyword: 'ACTIVE', toSql: () => `branch_active='Y'` },
    { keyword: 'NOTACTIVE', toSql: () => `branch_active='N'` },
  ]

  it('returns empty sql and params for empty criteria', () => {
    const result = whereGiven('', branchKeywords)
    expect(result.sql).toBe('')
    expect(result.params).toEqual({})
  })

  it('returns empty sql for whitespace criteria', () => {
    expect(whereGiven('   ', branchKeywords).sql).toBe('')
  })

  it('handles single keyword', () => {
    expect(whereGiven('ID(42)', branchKeywords).sql).toBe(' WHERE (id=42)')
  })

  it('handles ACTIVE shorthand (no parens)', () => {
    expect(whereGiven('ACTIVE', branchKeywords).sql).toBe(" WHERE (branch_active='Y')")
  })

  it('handles ACTIVE ONLY shorthand', () => {
    expect(whereGiven('active only', branchKeywords).sql).toBe(" WHERE (branch_active='Y')")
  })

  it('handles NOT ACTIVE shorthand', () => {
    expect(whereGiven('not active', branchKeywords).sql).toBe(" WHERE (branch_active='N')")
  })

  it('combines multiple keywords with AND', () => {
    const result = whereGiven('ID(42) ACTIVE', branchKeywords)
    expect(result.sql).toBe(" WHERE (id=42) AND (branch_active='Y')")
  })

  it('is case-insensitive', () => {
    expect(whereGiven('id(42)', branchKeywords).sql).toBe(' WHERE (id=42)')
  })

  it('applies free text search with parameterized LIKE', () => {
    const result = whereGiven('SEARCHTERM', branchKeywords, ['branch_name', 'branch_id'])
    expect(result.sql).toContain('branch_name LIKE @p0')
    expect(result.sql).toContain('branch_id LIKE @p0')
    expect(result.sql).toContain(' OR ')
    expect(result.params).toHaveProperty('p0', '%SEARCHTERM%')
  })

  it('returns params from SqlFragment-returning toSql', () => {
    const keywords: SearchKeyword[] = [
      {
        keyword: 'CODE',
        toSql: (p, paramId) => {
          const id = paramId()
          return { sql: `branch_id=@${id}`, params: { [id]: p } }
        },
      },
    ]
    const result = whereGiven('CODE(ABC)', keywords)
    expect(result.sql).toBe(' WHERE (branch_id=@p0)')
    expect(result.params).toEqual({ p0: 'ABC' })
  })
})
