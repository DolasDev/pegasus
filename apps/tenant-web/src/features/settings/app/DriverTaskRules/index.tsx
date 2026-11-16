// ---------------------------------------------------------------------------
// App Settings → Operations → Driver To Do
//
// Which built-in driver task rules are on (task queue plan, Phase 1). A task
// is computed from the driver's itinerary and the order's documents and goes
// away by itself once the data arrives. Every rule is off until enabled here.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DRIVER_TASK_RULES, DRIVER_TASK_RULE_LABELS, type DriverTaskRuleId } from '@pegasus/domain'
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

/** The rules in their canonical order, so a draft compares equal to storage. */
const ordered = (rules: Iterable<DriverTaskRuleId>): DriverTaskRuleId[] => {
  const set = new Set(rules)
  return DRIVER_TASK_RULES.filter((r) => set.has(r))
}

export function DriverTaskRulesCard() {
  const { data } = useQuery(appSettingsQueryOptions)
  const mutation = useUpdateAppSettings()
  const current = ordered(data?.operations.driverTaskRules ?? [])
  const [draft, setDraft] = useState<DriverTaskRuleId[] | null>(null)
  const value = draft ?? current
  const isDirty = draft !== null && draft.join() !== current.join()

  function toggle(rule: DriverTaskRuleId, on: boolean) {
    setDraft(ordered(on ? [...value, rule] : value.filter((r) => r !== rule)))
  }

  function handleSave() {
    mutation.mutate({ operations: { driverTaskRules: value } }, { onSuccess: () => setDraft(null) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Driver To Do</CardTitle>
        <CardDescription>
          Tasks drivers see in the mobile app&apos;s To Do list. Each one is worked out from the
          driver&apos;s itinerary and the order&apos;s documents, and clears itself once the act is
          marked done or the document is uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {DRIVER_TASK_RULES.map((rule) => (
          <label key={rule} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid={`driver-task-rule-${rule}`}
              checked={value.includes(rule)}
              onChange={(e) => toggle(rule, e.target.checked)}
            />
            {DRIVER_TASK_RULE_LABELS[rule]}
          </label>
        ))}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending}
          data-testid="driver-task-rules-save"
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
