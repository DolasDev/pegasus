import { describe, it, expect } from 'vitest'
import { whereGiven } from '../search-criteria'
import { eq, like } from '../../../handlers/pegii/keyword-helpers'

describe('SQL injection prevention', () => {
  const keywords = [eq('CODE', 'agent_id'), like('NAME', 'company')]

  it('parameterizes CODE with SQL injection attempt', () => {
    const result = whereGiven("CODE('; DROP TABLE account; --)", keywords)
    expect(result.sql).toBe(' WHERE (agent_id=@p0)')
    // Leading quote is stripped by parseKeywordAndParam — value is safely in params regardless
    expect(result.params.p0).toBeDefined()
    expect(result.sql).not.toContain('DROP')
    expect(result.sql).not.toContain("'")
  })

  it('parameterizes CODE with apostrophe in value', () => {
    const result = whereGiven("CODE(O'Brien)", keywords)
    expect(result.sql).toBe(' WHERE (agent_id=@p0)')
    expect(result.params).toEqual({ p0: "O'BRIEN" })
    expect(result.sql).not.toContain("O'Brien")
    expect(result.sql).not.toContain("O''Brien")
  })

  it('parameterizes free-text search with injection attempt', () => {
    const result = whereGiven("'; DROP TABLE--", keywords, ['company', 'name'])
    expect(result.sql).toContain('LIKE @p0')
    expect(result.params).toHaveProperty('p0')
    expect(result.sql).not.toContain('DROP')
    expect(result.sql).not.toContain("'")
  })

  it('parameterizes LIKE keyword with injection attempt', () => {
    const result = whereGiven("NAME('; DROP TABLE account; --)", keywords)
    expect(result.sql).toBe(' WHERE (company LIKE @p0)')
    // Leading quote stripped by parseKeywordAndParam — value is safely in params
    expect(result.params.p0).toBeDefined()
    expect(String(result.params.p0)).toContain('DROP TABLE ACCOUNT')
    expect(result.sql).not.toContain('DROP')
  })

  it('no raw user values appear in .sql output for parameterized keywords', () => {
    const result = whereGiven('CODE(TESTVALUE) NAME(SEARCHME)', keywords)
    expect(result.sql).not.toContain('TESTVALUE')
    expect(result.sql).not.toContain('SEARCHME')
    expect(result.sql).toContain('@p0')
    expect(result.sql).toContain('@p1')
    expect(result.params).toEqual({ p0: 'TESTVALUE', p1: '%SEARCHME%' })
  })

  it('assigns unique param names across multiple keywords', () => {
    const result = whereGiven('CODE(ABC) NAME(DEF)', keywords)
    expect(result.params).toEqual({ p0: 'ABC', p1: '%DEF%' })
    expect(result.sql).toContain('@p0')
    expect(result.sql).toContain('@p1')
  })
})
