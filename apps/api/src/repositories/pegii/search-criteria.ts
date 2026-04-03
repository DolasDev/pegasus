import type { SearchKeyword, SqlFragment } from '../../handlers/pegii/types'

function formatDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export function withTranslatedDates(criteria: string): string {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  let cri = criteria
  const yesterday = formatDate(addDays(now, -1))
  const today = formatDate(now)
  const tomorrow = formatDate(addDays(now, 1))

  cri = cri.replace(/\(YESTERDAY,/g, `(${yesterday},`).replace(/\(YESTERDAY\)/g, `(${yesterday})`)
  cri = cri.replace(/\(TODAY,/g, `(${today},`).replace(/\(TODAY\)/g, `(${today})`)
  cri = cri.replace(/\(TOMORROW,/g, `(${tomorrow},`).replace(/\(TOMORROW\)/g, `(${tomorrow})`)

  for (let i = 1; i <= 30; i++) {
    const plus = formatDate(addDays(now, i))
    const minus = formatDate(addDays(now, -i))
    cri = cri.replace(new RegExp(`\\(TODAY\\+${i}\\)`, 'g'), `(${plus})`)
    cri = cri.replace(new RegExp(`\\(TODAY\\+${i},`, 'g'), `(${plus},`)
    cri = cri.replace(new RegExp(`,TODAY\\+${i}\\)`, 'g'), `,${plus})`)
    cri = cri.replace(new RegExp(`,TODAY\\+${i},`, 'g'), `,${plus},`)
    cri = cri.replace(new RegExp(`\\(TODAY-${i}\\)`, 'g'), `(${minus})`)
    cri = cri.replace(new RegExp(`\\(TODAY-${i},`, 'g'), `(${minus},`)
    cri = cri.replace(new RegExp(`,TODAY-${i}\\)`, 'g'), `,${minus})`)
    cri = cri.replace(new RegExp(`,TODAY-${i},`, 'g'), `,${minus},`)
  }
  return cri
}

export function parseSearchWords(input: string): string[] {
  const words: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  for (const ch of input) {
    if (!inQuote && (ch === "'" || ch === '"')) {
      inQuote = true
      quoteChar = ch
      current += ch
    } else if (inQuote && ch === quoteChar) {
      inQuote = false
      current += ch
    } else if (!inQuote && ch === ' ') {
      if (current.trim()) words.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) words.push(current.trim())
  return words
}

export function parseKeywordAndParam(word: string): { keyword: string; param: string } {
  const parenIdx = word.indexOf('(')
  if (parenIdx === -1) return { keyword: word, param: '' }
  const keyword = word.substring(0, parenIdx)
  let param = word.substring(parenIdx + 1)
  if (param.endsWith(')')) param = param.slice(0, -1)
  param = param.replace(/^["']|["']$/g, '')
  return { keyword, param }
}

export function whereGiven(
  searchCriteria: string,
  keywords: SearchKeyword[],
  freeTextColumns?: string[],
): SqlFragment {
  if (!searchCriteria.trim()) return { sql: '', params: {} }

  let cri = withTranslatedDates(` ${searchCriteria.toUpperCase()} `)

  cri = cri.replace(/ ACTIVE ONLY /g, ' ACTIVE ')
  cri = cri.replace(/ NOT ACTIVE /g, ' NOTACTIVE ')
  cri = cri.replace(/ ACTIVE /g, ' ACTIVE() ')
  cri = cri.replace(/ NOTACTIVE /g, ' NOTACTIVE() ')
  cri = cri.trim()

  const keywordMap = new Map<string, SearchKeyword>()
  for (const kw of keywords) {
    keywordMap.set(kw.keyword.toUpperCase(), kw)
  }

  let n = 0
  const paramId = () => `p${n++}`
  const mergedParams: Record<string, unknown> = {}

  const words = parseSearchWords(cri.toUpperCase())
  const parts: string[] = []

  for (const word of words) {
    const { keyword, param } = parseKeywordAndParam(word)
    const kw = keywordMap.get(keyword)
    if (kw) {
      const result = kw.toSql(param, paramId)
      if (typeof result === 'string') {
        if (result) parts.push(`(${result})`)
      } else {
        if (result.sql) {
          parts.push(`(${result.sql})`)
          Object.assign(mergedParams, result.params)
        }
      }
    } else if (freeTextColumns && freeTextColumns.length > 0) {
      const pid = paramId()
      mergedParams[pid] = `%${word}%`
      const orParts = freeTextColumns.map((col) => `${col} LIKE @${pid}`)
      parts.push(`(${orParts.join(' OR ')})`)
    }
  }

  if (parts.length === 0) return { sql: '', params: {} }
  return { sql: ` WHERE ${parts.join(' AND ')}`, params: mergedParams }
}
