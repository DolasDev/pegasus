import type { SearchKeyword, SqlFragment } from './types'

export function empty(): SearchKeyword {
  return { keyword: 'EMPTY', toSql: () => '1=0' }
}

export function static_(keyword: string, sql: string): SearchKeyword {
  return { keyword, toSql: () => sql }
}

export function eq(keyword: string, column: string): SearchKeyword {
  return {
    keyword,
    toSql: (param, paramId): SqlFragment => {
      const id = paramId()
      return { sql: `${column}=@${id}`, params: { [id]: param } }
    },
  }
}

export function eqNum(keyword: string, column: string): SearchKeyword {
  return {
    keyword,
    toSql: (param, paramId): SqlFragment => {
      const id = paramId()
      return { sql: `${column}=@${id}`, params: { [id]: Number(param) } }
    },
  }
}

export function like(keyword: string, column: string): SearchKeyword {
  return {
    keyword,
    toSql: (param, paramId): SqlFragment => {
      const id = paramId()
      return { sql: `${column} LIKE @${id}`, params: { [id]: `%${param}%` } }
    },
  }
}

export function likeStart(keyword: string, column: string): SearchKeyword {
  return {
    keyword,
    toSql: (param, paramId): SqlFragment => {
      const id = paramId()
      return { sql: `${column} LIKE @${id}`, params: { [id]: `${param}%` } }
    },
  }
}

export function dateLte(keyword: string, column: string): SearchKeyword {
  return {
    keyword,
    toSql: (param, paramId): SqlFragment => {
      const id = paramId()
      return { sql: `${column} <= @${id}`, params: { [id]: param } }
    },
  }
}

export function dateGte(keyword: string, column: string): SearchKeyword {
  return {
    keyword,
    toSql: (param, paramId): SqlFragment => {
      const id = paramId()
      return { sql: `${column} >= @${id}`, params: { [id]: param } }
    },
  }
}
