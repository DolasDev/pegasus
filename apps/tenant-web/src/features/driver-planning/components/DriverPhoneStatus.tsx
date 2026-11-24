// ---------------------------------------------------------------------------
// "Can this driver get notifications?" — one line beside the Itinerary
// pickers, so a dispatcher can tell a driver who will never see a push (trip
// assignment, chat, blocked task) before relying on one.
//
// The state is what the driver's most recently used phone reported the last
// time the app was opened, so the line always says when that was.
// ---------------------------------------------------------------------------
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import {
  driverPhoneStatusQueryOptions,
  type DriverIds,
  type DriverPhoneStatus,
  type PhoneStatus,
} from '@/api/queries/driver-itinerary'

const VIEW: Record<
  PhoneStatus,
  { label: string; variant: 'success' | 'warning' | 'muted'; detail: string }
> = {
  on: { label: 'Notifications on', variant: 'success', detail: '' },
  off: {
    label: 'Notifications off',
    variant: 'warning',
    detail:
      'Pushes (trip assignments, chat, blocked tasks) won’t show on their phone. Ask them to open the app → Settings → Permissions → Notifications.',
  },
  unknown: {
    label: 'Notifications unknown',
    variant: 'muted',
    detail: 'Their app version is too old to report it.',
  },
  noApp: {
    label: 'No app',
    variant: 'muted',
    detail: 'This driver isn’t signed in to the mobile app on any phone.',
  },
  notLinked: {
    label: 'No login linked',
    variant: 'muted',
    detail: 'No user is mapped to this driver (Settings → Users).',
  },
}

function StatusLine({ who, data }: { who: string; data: DriverPhoneStatus }) {
  const view = VIEW[data.status]
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-medium">{who}:</span>
      <Badge variant={view.variant}>{view.label}</Badge>
      {data.lastSeenAt && (
        <span className="text-xs text-muted-foreground">
          as of the app’s last open, {new Date(data.lastSeenAt).toLocaleString()}
        </span>
      )}
      {view.detail && <span className="text-xs text-muted-foreground">{view.detail}</span>}
    </div>
  )
}

/**
 * One labelled line per picked id: the longhaul driver and the local crew can
 * be different people, so their answers are never merged.
 */
export function DriverPhoneStatusLine(ids: DriverIds) {
  const q = useQuery(driverPhoneStatusQueryOptions(ids))
  // Nothing picked, still loading, or unreadable: say nothing rather than guess.
  if (!q.data) return null
  const { longhaul, local } = q.data
  return (
    <div className="space-y-1" data-target="driver-phone-status">
      {longhaul && <StatusLine who="Longhaul driver" data={longhaul} />}
      {local && <StatusLine who="Local crew" data={local} />}
    </div>
  )
}
