import type { SearchKeyword, SqlFragment } from '../../handlers/pegii/types'
import { whereGiven } from './search-criteria'

export type WhereGivenFn = (searchCriteria: string) => SqlFragment

export function createWhereGivenFn(
  keywords: SearchKeyword[],
  freeTextColumns?: string[],
): WhereGivenFn {
  return (searchCriteria: string) => whereGiven(searchCriteria, keywords, freeTextColumns)
}

function extractSqlCriteria(criteria: string): string {
  const startIdx = criteria.indexOf('SQL(')
  if (startIdx === -1) return ''
  let depth = 0
  let endIdx = -1
  for (let i = startIdx + 4; i < criteria.length; i++) {
    if (criteria[i] === '(') depth++
    if (criteria[i] === ')') {
      if (depth === 0) {
        endIdx = i
        break
      }
      depth--
    }
  }
  if (endIdx === -1) return ''
  return criteria.substring(startIdx, endIdx + 1)
}

export function queryGiven(
  tableName: string,
  fields: string,
  searchCriteria: string,
  whereGivenFn: WhereGivenFn,
  orderBy?: string,
): SqlFragment {
  const sqlBlock = extractSqlCriteria(searchCriteria).trim()

  let qry: string
  let embeddedSql: string

  if (sqlBlock) {
    const before = searchCriteria.substring(0, searchCriteria.indexOf(sqlBlock))
    const after = searchCriteria.substring(searchCriteria.indexOf(sqlBlock) + sqlBlock.length)
    qry = (before + after).trim()
    embeddedSql = sqlBlock.substring(4, sqlBlock.length - 1).trim()
  } else {
    qry = searchCriteria
    embeddedSql = ''
  }

  let whr: string
  let params: Record<string, unknown>

  if (!embeddedSql) {
    const fragment = whereGivenFn(qry)
    whr = fragment.sql
    params = fragment.params
  } else if (!qry.trim()) {
    whr = embeddedSql
    params = {}
  } else {
    const fragment = whereGivenFn(qry)
    const sqlPart = embeddedSql.replace(/^\s*WHERE\s*/i, '')
    whr = fragment.sql ? `${fragment.sql} AND ${sqlPart}` : ` WHERE ${sqlPart}`
    params = fragment.params
  }

  const doubleBraceStart = whr.indexOf('{{')
  if (doubleBraceStart !== -1) {
    const doubleBraceEnd = whr.indexOf('}}', doubleBraceStart)
    if (doubleBraceEnd !== -1) {
      const pre = whr.substring(doubleBraceStart + 2, doubleBraceEnd)
      whr = pre + whr.substring(0, doubleBraceStart) + whr.substring(doubleBraceEnd + 2)
    }
  }

  const statement = `SELECT TOP 1000 ${fields} FROM ${tableName} ${whr}`.replace(/\s+/g, ' ').trim()
  const sql = orderBy ? `${statement} ${orderBy.trim()}` : statement
  return { sql, params }
}

export function queryGivenSubset(
  tableName: string,
  fields: string,
  subSet: string,
  searchCriteria: string,
  whereGivenFn: WhereGivenFn,
  orderBy?: string,
): SqlFragment {
  const sqlBlock = extractSqlCriteria(searchCriteria).trim()

  let qry: string
  let embeddedSql: string

  if (sqlBlock) {
    const before = searchCriteria.substring(0, searchCriteria.indexOf(sqlBlock))
    const after = searchCriteria.substring(searchCriteria.indexOf(sqlBlock) + sqlBlock.length)
    qry = (before + after).trim()
    embeddedSql = sqlBlock.substring(4, sqlBlock.length - 1).trim()
  } else {
    qry = searchCriteria
    embeddedSql = ''
  }

  let whr: string
  let params: Record<string, unknown>

  if (!embeddedSql) {
    const fragment = whereGivenWithSubset(subSet, qry, whereGivenFn)
    whr = fragment.sql
    params = fragment.params
  } else if (!qry.trim()) {
    whr = embeddedSql
    params = {}
  } else {
    const fragment = whereGivenWithSubset(subSet, qry, whereGivenFn)
    const sqlPart = embeddedSql.replace(/^\s*WHERE\s*/i, '')
    whr = fragment.sql ? `${fragment.sql} AND ${sqlPart}` : ` WHERE ${sqlPart}`
    params = fragment.params
  }

  const statement = `SELECT TOP 1000 ${fields} FROM ${tableName} ${whr}`.replace(/\s+/g, ' ').trim()
  const sql = orderBy ? `${statement} ${orderBy.trim()}` : statement
  return { sql, params }
}

function whereGivenWithSubset(
  subSet: string,
  searchCriteria: string,
  whereGivenFn: WhereGivenFn,
): SqlFragment {
  if (!subSet.trim()) return whereGivenFn(searchCriteria)
  if (!searchCriteria.trim()) return whereGivenFn(subSet)

  const frag1 = whereGivenFn(subSet)
  const frag2 = whereGivenFn(searchCriteria)

  const part1 = frag1.sql.replace(/ WHERE /i, '').trim()
  const part2 = frag2.sql.replace(/ WHERE /i, '').trim()

  const parts: string[] = []
  if (part1) parts.push(part1)
  if (part2) parts.push(part2)

  if (parts.length === 0) return { sql: '', params: {} }
  return {
    sql: ` WHERE (${parts.join(' AND ')})`,
    params: { ...frag1.params, ...frag2.params },
  }
}
