// ---------------------------------------------------------------------------
// App Settings → Operations → Driver ETAs
//
// Whether drivers may submit ETAs from the mobile app (the trip screen's
// Delivery / SIT-IN ETA editor and the itinerary's ETA action). Opt-in: off
// until a tenant admin turns it on. When off, the app hides its ETA editors and
// the API refuses driver ETA writes (403 DRIVER_ETA_DISABLED).
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { appSettingsQueryOptions, useUpdateAppSettings } from '@/api/queries/app-settings'

export function DriverEtaCard() {
  const { data } = useQuery(appSettingsQueryOptions)
  const mutation = useUpdateAppSettings()
  const current = data?.operations.driverEtaSubmission === true
  const [draft, setDraft] = useState<boolean | null>(null)
  const value = draft ?? current
  const isDirty = draft !== null && draft !== current

  function handleSave() {
    mutation.mutate(
      { operations: { driverEtaSubmission: value } },
      { onSuccess: () => setDraft(null) },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Driver ETAs</CardTitle>
        <CardDescription>
          Let drivers submit ETAs from the mobile app — the delivery ETA on their trips and the ETA
          on itinerary stops. When off, drivers see ETAs but can&apos;t change them; dispatch still
          can.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="driver-eta-submission"
            checked={value}
            onChange={(e) => setDraft(e.target.checked)}
          />
          Drivers can submit ETAs in the mobile app
        </label>
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending}
          data-testid="driver-eta-save"
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDraft(null)}
          disabled={!isDirty || mutation.isPending}
        >
          Reset
        </Button>
        {mutation.isError && (
          <span className="text-xs text-destructive">
            Save failed: {mutation.error instanceof Error ? mutation.error.message : 'unknown'}
          </span>
        )}
      </CardFooter>
    </Card>
  )
}
