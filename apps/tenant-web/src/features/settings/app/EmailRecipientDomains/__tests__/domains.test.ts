import { describe, it, expect } from 'vitest'
import { parseDomainList, formatDomainList } from '../domains'

describe('parseDomainList', () => {
  it('splits on newlines, commas and spaces; lowercases; de-duplicates', () => {
    expect(parseDomainList('NWMovers.com, nwmovers.com\nmail.example.co.uk  other.org')).toEqual({
      domains: ['nwmovers.com', 'mail.example.co.uk', 'other.org'],
      invalid: [],
    })
  })

  it('flags entries that are not bare domains', () => {
    expect(
      parseDomainList('user@nwmovers.com http://x.com localhost *.a.com ok.com').invalid,
    ).toEqual(['user@nwmovers.com', 'http://x.com', 'localhost', '*.a.com'])
  })

  it('treats blank input as an empty list (email disabled)', () => {
    expect(parseDomainList('  \n ')).toEqual({ domains: [], invalid: [] })
  })
})

describe('formatDomainList', () => {
  it('renders one domain per line, empty for null', () => {
    expect(formatDomainList(['a.com', 'b.com'])).toBe('a.com\nb.com')
    expect(formatDomainList(null)).toBe('')
  })
})
