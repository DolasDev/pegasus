import { describe, it, expect } from 'vitest'
import { parseMentions } from '@pegasus/domain'
import {
  activeMentionQuery,
  encodeMentions,
  filterMentionable,
  insertMention,
} from './mention-input'

describe('activeMentionQuery', () => {
  it('finds the @query being typed at the caret', () => {
    expect(activeMentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' })
    expect(activeMentionQuery('@', 1)).toEqual({ start: 0, query: '' })
  })

  it('ignores an @ inside a word, or once a space was typed after it', () => {
    expect(activeMentionQuery('mail a@b', 8)).toBeNull()
    expect(activeMentionQuery('hi @ann lee', 11)).toBeNull()
    expect(activeMentionQuery('no mention', 10)).toBeNull()
  })
})

describe('insertMention', () => {
  it('replaces the query with the picked name and moves the caret past it', () => {
    expect(insertMention('hi @an there', 6, 'Ann Lee')).toEqual({
      text: 'hi @Ann Lee  there',
      caret: 12,
    })
  })
})

describe('encodeMentions', () => {
  const picked = [
    { name: 'Ann', userId: 'u-1' },
    { name: 'Ann Lee', userId: 'u-2' },
  ]

  it('turns picked names into tokens the API parses, longest name first', () => {
    const body = encodeMentions('@Ann Lee and @Ann, please check', picked)
    expect(body).toBe('@[Ann Lee](u-2) and @[Ann](u-1), please check')
    expect(parseMentions(body, new Set(['u-1', 'u-2']))).toEqual(['u-2', 'u-1'])
  })

  it('leaves unpicked names and partial words alone', () => {
    expect(encodeMentions('@Bob and @Annie', picked)).toBe('@Bob and @Annie')
    expect(encodeMentions('plain text', [])).toBe('plain text')
  })

  it('handles names with regex characters (emails)', () => {
    expect(encodeMentions('@ops@x.test ok', [{ name: 'ops@x.test', userId: 'u-3' }])).toBe(
      '@[ops@x.test](u-3) ok',
    )
  })
})

describe('filterMentionable', () => {
  it('matches anywhere in the name, case-insensitively, up to the limit', () => {
    const list = [{ name: 'Ann Lee' }, { name: 'Bo Ann' }, { name: 'Cy' }]
    expect(filterMentionable(list, 'ann').map((x) => x.name)).toEqual(['Ann Lee', 'Bo Ann'])
    expect(filterMentionable(list, '', 2)).toHaveLength(2)
  })
})
