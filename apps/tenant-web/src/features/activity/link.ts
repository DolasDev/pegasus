// ---------------------------------------------------------------------------
// Where an Activity row opens on the web, from its `data` payload (the same
// deep-link contract the mobile app routes on: lib/push-triggers, lib/notify).
// Null when the type has no web screen.
// ---------------------------------------------------------------------------

export type ActivityLink =
  | { to: '/messages/shipment/$orderNum'; params: { orderNum: string } }
  | { to: '/driver-planning/trips/$tripId'; params: { tripId: string } }
  | { to: '/support/$threadId'; params: { threadId: string } }

const id = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null

export function activityLink(
  data: Record<string, unknown> | null | undefined,
): ActivityLink | null {
  if (!data) return null
  switch (data['type']) {
    // A chat message or a blocked task: the order's conversation, where the
    // office can reach the driver.
    case 'chat.message':
    case 'task.blocked':
    case 'workflow.message': {
      const orderNum = id(data['orderNum'])
      return orderNum ? { to: '/messages/shipment/$orderNum', params: { orderNum } } : null
    }
    case 'trip.assigned': {
      const tripId = id(data['tripId'])
      return tripId ? { to: '/driver-planning/trips/$tripId', params: { tripId } } : null
    }
    // Pegasus support answered one of my requests.
    case 'support.reply': {
      const threadId = id(data['threadId'])
      return threadId ? { to: '/support/$threadId', params: { threadId } } : null
    }
    default:
      return null
  }
}
