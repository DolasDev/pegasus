// ---------------------------------------------------------------------------
// Activity feed — the caller's notifications (`/api/v1/me/activity`) and their
// per-type channels (`/api/v1/me/notification-preferences`). Source of truth:
// apps/api/src/handlers/me-activity.ts. Postgres-only on the server, so the
// bell's count may poll.
// ---------------------------------------------------------------------------

import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { NotificationChannel, NotificationType } from '@pegasus/domain'
import { apiFetch, apiFetchPaginated } from '@/api/client'

export interface ActivityItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  entityType: string | null
  entityId: string | null
  groupKey: string | null
  actorName: string | null
  createdAt: string
  seenAt: string | null
  readAt: string | null
}

export interface NotificationPreferenceRow {
  type: NotificationType
  label: string
  defaultChannel: NotificationChannel
  channel: NotificationChannel
}

/** How often the bell re-reads its count while the tab is open. */
export const UNSEEN_POLL_MS = 60_000

export const activityKeys = {
  all: ['activity'] as const,
  unseen: () => [...activityKeys.all, 'unseen'] as const,
  list: () => [...activityKeys.all, 'list'] as const,
  preferences: () => [...activityKeys.all, 'preferences'] as const,
}

export const unseenCountQueryOptions = queryOptions({
  queryKey: activityKeys.unseen(),
  queryFn: async () =>
    (await apiFetch<{ unseen: number }>('/api/v1/me/activity/unseen-count')).unseen,
  refetchInterval: UNSEEN_POLL_MS,
  refetchOnWindowFocus: true,
})

export const activityListQueryOptions = queryOptions({
  queryKey: activityKeys.list(),
  queryFn: async () => (await apiFetchPaginated<ActivityItem>('/api/v1/me/activity?limit=20')).data,
})

export const notificationPreferencesQueryOptions = queryOptions({
  queryKey: activityKeys.preferences(),
  queryFn: () => apiFetch<NotificationPreferenceRow[]>('/api/v1/me/notification-preferences'),
})

function useActivityMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: activityKeys.all }),
  })
}

/** Opening the panel clears the bell. */
export const useMarkActivitySeen = () =>
  useActivityMutation<void>(() => apiFetch('/api/v1/me/activity/seen', { method: 'POST' }))

export const useMarkActivityRead = () =>
  useActivityMutation<string>((id) =>
    apiFetch(`/api/v1/me/activity/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  )

export const useMarkAllActivityRead = () =>
  useActivityMutation<void>(() => apiFetch('/api/v1/me/activity/read-all', { method: 'POST' }))

export function useSetNotificationPreference() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { type: NotificationType; channel: NotificationChannel }) =>
      apiFetch<NotificationPreferenceRow[]>('/api/v1/me/notification-preferences', {
        method: 'PUT',
        body: JSON.stringify(v),
      }),
    onSuccess: (rows) => qc.setQueryData(activityKeys.preferences(), rows),
  })
}
