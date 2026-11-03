import type { ChatInboxEntry, ChatSummary } from '../services/chatService'
import { filterEntries, inboxOrderNums, previewText, searchedOrderNum } from './inbox'

function entry(orderNum: string, extra: Partial<ChatInboxEntry> = {}): ChatInboxEntry {
  return {
    room: { id: `r-${orderNum}`, entityType: 'shipment', entityId: orderNum, lastMessageAt: null },
    lastMessage: null,
    unreadCount: 0,
    unreadMentionCount: 0,
    following: true,
    muted: false,
    ...extra,
  }
}

const summaries: Record<number, ChatSummary> = {
  4242: {
    orderNum: 4242,
    shipperName: 'SMITH, JOHN',
    origin: null,
    destination: null,
    packDate: null,
    loadDate: null,
    deliveryDate: null,
  },
}

describe('filterEntries', () => {
  const list = [
    entry('4242', { unreadCount: 2, unreadMentionCount: 1 }),
    entry('5150', { unreadCount: 1 }),
    entry('6000'),
  ]

  it('filters by unread and by mentions', () => {
    expect(filterEntries(list, 'all', '', summaries)).toHaveLength(3)
    expect(filterEntries(list, 'unread', '', summaries).map((e) => e.room.entityId)).toEqual([
      '4242',
      '5150',
    ])
    expect(filterEntries(list, 'mentions', '', summaries).map((e) => e.room.entityId)).toEqual([
      '4242',
    ])
  })

  it('searches by order-number prefix or shipper name', () => {
    expect(filterEntries(list, 'all', '#51', summaries).map((e) => e.room.entityId)).toEqual([
      '5150',
    ])
    expect(filterEntries(list, 'all', 'smith', summaries).map((e) => e.room.entityId)).toEqual([
      '4242',
    ])
  })
})

describe('searchedOrderNum', () => {
  it('accepts a plain or #-prefixed positive int32', () => {
    expect(searchedOrderNum('4242')).toBe(4242)
    expect(searchedOrderNum(' #4242 ')).toBe(4242)
    expect(searchedOrderNum('0')).toBeNull()
    expect(searchedOrderNum('smith')).toBeNull()
    expect(searchedOrderNum('2147483648')).toBeNull()
  })
})

describe('previewText', () => {
  it('shows mention tokens as names and a deleted message as such', () => {
    expect(previewText('hi @[Ann Lee](u-1)!')).toBe('hi @Ann Lee!')
    expect(previewText(null)).toBe('Message deleted')
  })
})

describe('inboxOrderNums', () => {
  it('keeps only valid order numbers', () => {
    expect(inboxOrderNums([entry('4242'), entry('abc')])).toEqual([4242])
  })
})
