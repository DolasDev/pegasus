import { describe, it, expect } from 'vitest'
import { DomainError } from '../../shared/errors'
import {
  CHAT_ENTITY_TYPES,
  MAX_CHAT_BODY_LENGTH,
  parseChatRoomRef,
  validateChatBody,
  isValidClientMessageId,
  parseMentions,
  splitMentions,
  formatMentionToken,
  resolveChatScope,
  resolveRecipients,
  chatPushContent,
} from '../index'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    if (err instanceof DomainError) return err.code
    throw err
  }
  return undefined
}

describe('parseChatRoomRef', () => {
  it('accepts a shipment keyed by a positive order number', () => {
    expect(parseChatRoomRef('shipment', '12345')).toEqual({
      entityType: 'shipment',
      entityId: '12345',
    })
  })

  it('v1 supports shipment rooms only (D3)', () => {
    expect(CHAT_ENTITY_TYPES).toEqual(['shipment'])
    expect(codeOf(() => parseChatRoomRef('move', 'a1b2'))).toBe('CHAT_UNSUPPORTED_ENTITY')
    expect(codeOf(() => parseChatRoomRef('', '1'))).toBe('CHAT_UNSUPPORTED_ENTITY')
  })

  it.each(['0', '-4', '01', '1.5', 'abc', '', ' 12', '2147483648', '99999999999'])(
    'rejects order number %j',
    (raw) => {
      expect(codeOf(() => parseChatRoomRef('shipment', raw))).toBe('CHAT_INVALID_ENTITY_ID')
    },
  )

  it('accepts the largest SQL Server int', () => {
    expect(parseChatRoomRef('shipment', '2147483647').entityId).toBe('2147483647')
  })
})

describe('validateChatBody', () => {
  it('trims surrounding whitespace and normalizes CRLF', () => {
    expect(validateChatBody('  hello\r\nthere  ')).toBe('hello\nthere')
  })

  it.each([undefined, null, 42, '', '   ', '\n\t'])('rejects empty body %j', (raw) => {
    expect(codeOf(() => validateChatBody(raw))).toBe('CHAT_BODY_EMPTY')
  })

  it('accepts exactly the maximum length and rejects one more', () => {
    expect(validateChatBody('x'.repeat(MAX_CHAT_BODY_LENGTH))).toHaveLength(MAX_CHAT_BODY_LENGTH)
    expect(codeOf(() => validateChatBody('x'.repeat(MAX_CHAT_BODY_LENGTH + 1)))).toBe(
      'CHAT_BODY_TOO_LONG',
    )
  })
})

describe('isValidClientMessageId', () => {
  it.each(['0f8fad5b-d9cb-469f-a165-70867728950e', 'abcdEFGH', 'a'.repeat(64), 'm_1-2_3x'])(
    'accepts %j',
    (raw) => expect(isValidClientMessageId(raw)).toBe(true),
  )

  it.each([undefined, 7, '', 'short', 'a'.repeat(65), 'has space', 'semi;colon'])(
    'rejects %j',
    (raw) => expect(isValidClientMessageId(raw)).toBe(false),
  )
})

describe('splitMentions', () => {
  it('cuts a body into text and mention segments', () => {
    expect(splitMentions('hi @[Ann Lee](u-2), see @[Bo](u-1)')).toEqual([
      { kind: 'text', text: 'hi ' },
      { kind: 'mention', name: 'Ann Lee', userId: 'u-2' },
      { kind: 'text', text: ', see ' },
      { kind: 'mention', name: 'Bo', userId: 'u-1' },
    ])
  })

  it('handles a body that starts with, or is only, adjacent tokens', () => {
    expect(splitMentions('@[A](u-1)@[B](u-2)')).toEqual([
      { kind: 'mention', name: 'A', userId: 'u-1' },
      { kind: 'mention', name: 'B', userId: 'u-2' },
    ])
  })

  it('returns plain text whole, and nothing for an empty body', () => {
    expect(splitMentions('no tokens @here')).toEqual([{ kind: 'text', text: 'no tokens @here' }])
    expect(splitMentions('')).toEqual([])
  })
})

describe('formatMentionToken', () => {
  it('builds a token that parses back to the same user', () => {
    const token = formatMentionToken('Ann Lee', 'u-2')
    expect(token).toBe('@[Ann Lee](u-2)')
    expect(parseMentions(token, new Set(['u-2']))).toEqual(['u-2'])
  })

  it('strips characters the token cannot carry and caps the name', () => {
    expect(formatMentionToken('a]b\nc', 'u-1')).toBe('@[a b c](u-1)')
    expect(formatMentionToken('x'.repeat(150), 'u-1')).toBe(`@[${'x'.repeat(100)}](u-1)`)
    expect(formatMentionToken(' ] ', 'u-1')).toBe('@[user](u-1)')
  })
})

describe('parseMentions', () => {
  const known = new Set(['u-1', 'u-2'])

  it('returns mentioned user ids in order of first appearance, de-duplicated', () => {
    const body = 'hi @[Ann Lee](u-2) and @[Bo](u-1), also @[Ann Lee](u-2)'
    expect(parseMentions(body, known)).toEqual(['u-2', 'u-1'])
  })

  it('drops ids that are not mentionable in this room', () => {
    expect(parseMentions('@[Eve](u-9) @[Bo](u-1)', known)).toEqual(['u-1'])
  })

  it('ignores plain @words and malformed tokens', () => {
    expect(parseMentions('email bo@x.com @Bo @[Bo] (u-1) @[](u-1)', known)).toEqual([])
  })
})

describe('resolveChatScope (D1: by role, not employment status)', () => {
  it('a driver-only login gets driver scope', () => {
    expect(resolveChatScope(['driver'])).toBe('driver')
  })

  it('a login with no roles gets driver scope (fail closed)', () => {
    expect(resolveChatScope([])).toBe('driver')
  })

  it('any other role makes the caller an employee, even alongside driver', () => {
    expect(resolveChatScope(['sales'])).toBe('employee')
    expect(resolveChatScope(['driver', 'billing_manager'])).toBe('employee')
  })
})

describe('resolveRecipients', () => {
  const base = {
    authorId: 'a',
    followerIds: [] as string[],
    mutedIds: [] as string[],
    mentionedIds: [] as string[],
    assignedUserIds: [] as string[],
  }

  it('unions followers, mentioned and assigned users, minus the author', () => {
    expect(
      resolveRecipients({
        ...base,
        followerIds: ['f', 'a'],
        mentionedIds: ['m'],
        assignedUserIds: ['d', 'f'],
      }),
    ).toEqual(['d', 'f', 'm'])
  })

  it('muting silences followers and assigned users', () => {
    expect(
      resolveRecipients({
        ...base,
        followerIds: ['f'],
        assignedUserIds: ['d'],
        mutedIds: ['f', 'd'],
      }),
    ).toEqual([])
  })

  it('a mention gets through a mute', () => {
    expect(resolveRecipients({ ...base, mentionedIds: ['m'], mutedIds: ['m'] })).toEqual(['m'])
  })

  it('never notifies the author, even when they mention themselves', () => {
    expect(resolveRecipients({ ...base, mentionedIds: ['a'] })).toEqual([])
  })
})

describe('chatPushContent (D5: never the message text)', () => {
  it('names the order and the author', () => {
    expect(chatPushContent({ orderNum: '123', authorName: 'Ann Lee', mentioned: false })).toEqual({
      title: '#123',
      body: 'New message from Ann Lee',
    })
  })

  it('says so when the recipient was mentioned', () => {
    expect(chatPushContent({ orderNum: '9', authorName: 'Bo', mentioned: true }).body).toBe(
      'Bo mentioned you',
    )
  })

  it('falls back to a generic author name', () => {
    expect(chatPushContent({ orderNum: '9', authorName: '  ', mentioned: false }).body).toBe(
      'New message from a teammate',
    )
  })
})
