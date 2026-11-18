// ---------------------------------------------------------------------------
// /notifications/settings — the signed-in user's own notification channels:
// per type, Push (Activity + a push to their phone), Activity only, or Off.
// Every user, any role (it's their own preference, not tenant config).
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query'
import type { NotificationChannel } from '@pegasus/domain'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  notificationPreferencesQueryOptions,
  useSetNotificationPreference,
} from '@/api/queries/activity'

const CHOICES: { channel: NotificationChannel; label: string }[] = [
  { channel: 'push', label: 'Push' },
  { channel: 'feed', label: 'Activity only' },
  { channel: 'off', label: 'Off' },
]

export function NotificationSettingsPage() {
  const { data, isLoading, isError } = useQuery(notificationPreferencesQueryOptions)
  const save = useSetNotificationPreference()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (isError || !data) {
    return <p className="text-sm text-destructive">Couldn’t load your notification settings.</p>
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Where each kind of notification goes. Push also sends it to your phone if you use the
          Pegasus mobile app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.map((row) => (
          <fieldset key={row.type} className="space-y-1">
            <legend className="text-sm font-medium">{row.label}</legend>
            <div className="flex gap-4">
              {CHOICES.map((c) => (
                <label key={c.channel} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name={row.type}
                    checked={row.channel === c.channel}
                    disabled={save.isPending}
                    onChange={() => save.mutate({ type: row.type, channel: c.channel })}
                    data-testid={`pref-${row.type}-${c.channel}`}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {save.isError && <p className="text-xs text-destructive">Save failed. Please try again.</p>}
      </CardContent>
    </Card>
  )
}
