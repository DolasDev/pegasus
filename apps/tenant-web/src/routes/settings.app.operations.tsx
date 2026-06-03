// ---------------------------------------------------------------------------
// App Settings → Operations
//
// First section to ship a real control: the per-tenant Longhaul Client
// selector. Drives the per-tenant SQL used by the cloud Operations endpoints
// (dispatchers, filter-options, shipments-list). Until set, those endpoints
// 422 with LONGHAUL_CLIENT_NOT_CONFIGURED — which is why this UI exists.
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
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  appSettingsQueryOptions,
  useUpdateAppSettings,
  type LonghaulClient,
} from '@/api/queries/app-settings'
import { DriverImportCard } from '@/features/settings/app/DriverImport'

// The three storage states the dropdown represents. `''` = "not configured",
// modeled separately from `'nwi' | 'qmm'` so the controlled <select> can render
// it as an explicit placeholder option instead of an empty selection.
type DropdownValue = '' | LonghaulClient

const CLIENT_OPTIONS: { value: LonghaulClient; label: string }[] = [
  { value: 'nwi', label: 'NWI' },
  { value: 'qmm', label: 'QMM' },
]

export function AppSettingsOperationsPage() {
  const { data, isLoading, isError, error } = useQuery(appSettingsQueryOptions)
  const mutation = useUpdateAppSettings()

  // Local working copy of the dropdown — seeded once data lands. Saving snaps
  // back to server state on success (cache update inside useUpdateAppSettings).
  const [draft, setDraft] = useState<DropdownValue | null>(null)
  const current: DropdownValue = data?.operations.longhaulClient ?? ''
  const value: DropdownValue = draft ?? current
  const isDirty = draft !== null && draft !== current

  function handleSave() {
    const next: LonghaulClient | null = value === '' ? null : value
    mutation.mutate({ operations: { longhaulClient: next } }, { onSuccess: () => setDraft(null) })
  }

  function handleReset() {
    setDraft(null)
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Failed to load settings: {error instanceof Error ? error.message : 'unknown error'}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Longhaul Client</CardTitle>
          <CardDescription>
            Selects per-tenant SQL for the cloud Operations endpoints (dispatchers, filter options,
            Trip-Planning shipment codes). Each option corresponds to a hardcoded configuration in
            the API — pick the one matching your legacy deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="longhaul-client">Client</Label>
          <select
            id="longhaul-client"
            data-testid="longhaul-client-select"
            className="block w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={value}
            onChange={(e) => setDraft(e.target.value as DropdownValue)}
          >
            <option value="">— Not configured —</option>
            {CLIENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Affects: Operations → Shipments (Trip-Planning filter codes), Dispatchers list, Move
            Type filter options. While left at <em>— Not configured —</em>, those endpoints return a
            422 error.
          </p>
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || mutation.isPending}
            data-testid="longhaul-client-save"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleReset}
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
      <DriverImportCard />
    </div>
  )
}
