import type { NotificationChannel, NotificationType } from '@pegasus/domain'
import { getApiClient } from '../api/client'
import type { ActivityItem, ActivityPage, NotificationPreferenceRow } from '../types/activity'

// ---------------------------------------------------------------------------
// Activity service — the caller's Activity feed (`/api/v1/me/activity`) and
// their per-type notification channels (`/api/v1/me/notification-preferences`).
// Postgres only on the server, so these are cheap to call.
// ---------------------------------------------------------------------------

const ACTIVITY = '/api/v1/me/activity'
const PREFS = '/api/v1/me/notification-preferences'

export class ActivityService {
  static async list(
    opts: { cursor?: string | null; filter?: 'all' | 'unread' } = {},
  ): Promise<ActivityPage> {
    const qs = new URLSearchParams({ filter: opts.filter ?? 'all' })
    if (opts.cursor) qs.set('cursor', opts.cursor)
    const res = await getApiClient().fetchPaginated<ActivityItem>(`${ACTIVITY}?${qs.toString()}`)
    const meta = res.meta as unknown as { nextCursor?: string | null; unseen?: number } | undefined
    return {
      items: res.data ?? [],
      nextCursor: meta?.nextCursor ?? null,
      unseen: meta?.unseen ?? 0,
    }
  }

  static async unseenCount(): Promise<number> {
    const res = await getApiClient().fetch<{ unseen: number }>(`${ACTIVITY}/unseen-count`)
    return res.unseen ?? 0
  }

  /** Opening the Activity screen clears the bell. */
  static async markSeen(): Promise<void> {
    await getApiClient().fetch(`${ACTIVITY}/seen`, { method: 'POST' })
  }

  static async markRead(id: string): Promise<void> {
    await getApiClient().fetch(`${ACTIVITY}/${encodeURIComponent(id)}/read`, { method: 'POST' })
  }

  static async markAllRead(): Promise<void> {
    await getApiClient().fetch(`${ACTIVITY}/read-all`, { method: 'POST' })
  }

  static async getPreferences(): Promise<NotificationPreferenceRow[]> {
    return getApiClient().fetch<NotificationPreferenceRow[]>(PREFS)
  }

  static async setPreference(
    type: NotificationType,
    channel: NotificationChannel,
  ): Promise<NotificationPreferenceRow[]> {
    return getApiClient().fetch<NotificationPreferenceRow[]>(PREFS, {
      method: 'PUT',
      body: JSON.stringify({ type, channel }),
    })
  }
}
