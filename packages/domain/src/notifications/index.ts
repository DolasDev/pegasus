// ---------------------------------------------------------------------------
// Notifications — the Activity feed's type registry (task queue plan, TQ-D1).
//
// Activity is a feed with one row per recipient; push is one of its channels.
// Every notification has a registered type, and each type carries a label (for
// the preferences screen) and the channel it uses until the user changes it:
//
//   • push — a feed row AND a push to their phone;
//   • feed — a feed row only;
//   • off  — nothing.
//
// The types that already pushed before Activity existed default to `push`, so
// moving them onto notify() changes nobody's phone.
//
// Plan: plans/todo/task-queue-and-activity-feed.md §3 Phase 2.
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS = ['push', 'feed', 'off'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const NOTIFICATION_TYPES = [
  'trip.assigned',
  'move.assigned',
  'chat.mention',
  'staff.message',
  'task.blocked',
  'workflow.message',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface NotificationTypeInfo {
  label: string
  defaultChannel: NotificationChannel
}

export const NOTIFICATION_TYPE_INFO: Record<NotificationType, NotificationTypeInfo> = {
  'trip.assigned': { label: 'A trip is assigned to you', defaultChannel: 'push' },
  'move.assigned': { label: 'A move is assigned to you', defaultChannel: 'push' },
  'chat.mention': { label: 'Someone @mentions you in a move chat', defaultChannel: 'push' },
  'staff.message': { label: 'The office sends you a message', defaultChannel: 'push' },
  // Andon: a stopped driver should be heard, so this pushes by default.
  'task.blocked': { label: 'A driver is blocked on a task', defaultChannel: 'push' },
  // Tenant Workflows can post often; feed-only until a user opts into push.
  'workflow.message': { label: 'Updates from your company’s automations', defaultChannel: 'feed' },
}

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(v)
}

export function isNotificationChannel(v: unknown): v is NotificationChannel {
  return typeof v === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(v)
}

/** The channel a user gets for `type`: their own choice, else the type's default. */
export function effectiveChannel(
  type: NotificationType,
  preference: NotificationChannel | null | undefined,
): NotificationChannel {
  return preference ?? NOTIFICATION_TYPE_INFO[type].defaultChannel
}

/** What a channel writes. */
export function channelWrites(channel: NotificationChannel): { feed: boolean; push: boolean } {
  return { feed: channel !== 'off', push: channel === 'push' }
}
