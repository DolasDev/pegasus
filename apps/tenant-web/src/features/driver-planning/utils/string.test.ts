import { describe, it, expect } from 'vitest'
import { startCase } from './string'

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
