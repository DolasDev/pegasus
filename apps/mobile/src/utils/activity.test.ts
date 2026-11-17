import type { ActivityItem } from '../types/activity'
import { groupActivity, rowTitle, shortAge } from './activity'

function item(over: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'x',
    type: 'chat.mention',
    title: 'Sam mentioned you on #4242',
    body: '',
    data: {},
    entityType: 'order',
    entityId: '4242',
    groupKey: 'order:4242',
    actorName: 'Sam',
    createdAt: '2026-11-17T10:00:00Z',
    seenAt: null,
    readAt: null,
    ...over,
  }
}

describe('groupActivity', () => {
  it('collapses consecutive items with one group key, led by the newest', () => {
    const rows = groupActivity([
      item({ id: 'a', readAt: '2026-11-17T11:00:00Z' }),
      item({ id: 'b' }),
      item({ id: 'c', groupKey: null, title: 'New trip assigned' }),
      item({ id: 'd' }),
    ])
    expect(rows.map((r) => [r.lead.id, r.items.map((i) => i.id), r.unread])).toEqual([
      ['a', ['a', 'b'], true],
      ['c', ['c'], true],
      ['d', ['d'], true],
    ])
    expect(rowTitle(rows[0]!)).toBe('2 updates on #4242')
    expect(rowTitle(rows[1]!)).toBe('New trip assigned')
  })

  it('never groups items without a key', () => {
    const rows = groupActivity([
      item({ id: 'a', groupKey: null }),
      item({ id: 'b', groupKey: null }),
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('shortAge', () => {
  const now = new Date('2026-11-17T12:00:00Z')
  it('reads as now / minutes / hours / days', () => {
    expect(shortAge('2026-11-17T11:59:40Z', now)).toBe('now')
    expect(shortAge('2026-11-17T11:55:00Z', now)).toBe('5m')
    expect(shortAge('2026-11-17T09:00:00Z', now)).toBe('3h')
    expect(shortAge('2026-11-15T12:00:00Z', now)).toBe('2d')
  })
})
