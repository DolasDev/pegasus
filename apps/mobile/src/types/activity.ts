// ---------------------------------------------------------------------------
// Activity feed — the API's row contract (`GET /api/v1/me/activity`). Source of
// truth: apps/api/src/handlers/me-activity.ts.
// ---------------------------------------------------------------------------

import type { NotificationChannel, NotificationType } from '@pegasus/domain'

export interface ActivityItem {
  id: string
  type: string
  title: string
  body: string
  /** The deep-link payload — the same `data` the push carried. */
  data: Record<string, unknown>
  entityType: string | null
  entityId: string | null
  /** Items sharing a group key show as one ("3 updates on #4242"). */
  groupKey: string | null
  actorName: string | null
  createdAt: string
  seenAt: string | null
  readAt: string | null
}

export interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
  unseen: number
}

export interface NotificationPreferenceRow {
  type: NotificationType
  label: string
  defaultChannel: NotificationChannel
  channel: NotificationChannel
}
