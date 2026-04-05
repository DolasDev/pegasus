import { cn } from '../lib/utils'

describe('cn', () => {
  it('merges basic class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('ignores falsy conditional classes', () => {
    const condition = false
    expect(cn('foo', condition && 'bar', 'baz')).toBe('foo baz')
  })

  it('resolves tailwind merge conflicts (last class wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })
})
