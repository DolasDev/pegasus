import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_INFO,
  channelWrites,
  effectiveChannel,
  isNotificationChannel,
  isNotificationType,
} from '../index'

describe('notification types', () => {
  it('registers every type with a label and a default channel', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPE_INFO[t].label.length).toBeGreaterThan(0)
      expect(isNotificationChannel(NOTIFICATION_TYPE_INFO[t].defaultChannel)).toBe(true)
    }
  })

  it('keeps the types that pushed before Activity on push', () => {
    for (const t of ['trip.assigned', 'move.assigned', 'chat.mention', 'staff.message'] as const) {
      expect(NOTIFICATION_TYPE_INFO[t].defaultChannel).toBe('push')
    }
  })

  it('guards types and channels', () => {
    expect(isNotificationType('chat.mention')).toBe(true)
    expect(isNotificationType('chat.message')).toBe(false)
    expect(isNotificationType(1)).toBe(false)
    expect(isNotificationChannel('feed')).toBe(true)
    expect(isNotificationChannel('email')).toBe(false)
  })
})

describe('effectiveChannel / channelWrites', () => {
  it("uses the user's choice, else the default", () => {
    expect(effectiveChannel('trip.assigned', null)).toBe('push')
    expect(effectiveChannel('trip.assigned', undefined)).toBe('push')
    expect(effectiveChannel('trip.assigned', 'off')).toBe('off')
  })

  it('maps a channel to what it writes', () => {
    expect(channelWrites('push')).toEqual({ feed: true, push: true })
    expect(channelWrites('feed')).toEqual({ feed: true, push: false })
    expect(channelWrites('off')).toEqual({ feed: false, push: false })
  })
})
