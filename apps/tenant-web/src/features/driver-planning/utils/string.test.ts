import { describe, it, expect } from 'vitest'
import { startCase, lastCommaFirst } from './string'

describe('startCase', () => {
  it('capitalises a simple lowercase word', () => {
    expect(startCase('hello')).toBe('Hello')
  })

  it('splits camelCase into words', () => {
    expect(startCase('helloWorld')).toBe('Hello World')
  })

  it('replaces underscores with spaces', () => {
    expect(startCase('hello_world')).toBe('Hello World')
  })

  it('replaces dashes with spaces', () => {
    expect(startCase('hello-world')).toBe('Hello World')
  })

  it('collapses multiple whitespace characters', () => {
    expect(startCase('hello   world')).toBe('Hello World')
  })

  it('trims leading and trailing whitespace', () => {
    expect(startCase('  hello world  ')).toBe('Hello World')
  })

  it('handles a mix of conventions', () => {
    expect(startCase('foo_barBaz-qux')).toBe('Foo Bar Baz Qux')
  })

  it('returns empty string for empty input', () => {
    expect(startCase('')).toBe('')
  })
})

describe('lastCommaFirst', () => {
  it('joins last and first names with the legacy comma-space-space format', () => {
    expect(lastCommaFirst('alice', 'smith')).toBe('Smith , Alice')
  })

  it('start-cases input regardless of original casing', () => {
    expect(lastCommaFirst('ALICE', 'SMITH')).toBe('Smith , Alice')
    expect(lastCommaFirst('mARy ANNE', 'O CONNOR')).toBe('O Connor , Mary Anne')
  })

  it('returns "N/A" when both parts are missing', () => {
    expect(lastCommaFirst(null, undefined)).toBe('N/A')
    expect(lastCommaFirst('', '')).toBe('N/A')
  })

  it('renders a single side when only one part is present', () => {
    expect(lastCommaFirst('alice', null)).toBe(' , Alice')
    expect(lastCommaFirst(undefined, 'smith')).toBe('Smith , ')
  })

  it('coerces non-string inputs to strings', () => {
    expect(lastCommaFirst(1, 2)).toBe('2 , 1')
  })
})
