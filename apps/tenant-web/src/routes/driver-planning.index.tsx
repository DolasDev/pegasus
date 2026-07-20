// ---------------------------------------------------------------------------
// Availability route — renders View A by default and exposes a "Change View"
// tab control in the upper right so dispatchers can switch to another variant.
//
// Each variant lives under features/driver-planning/availability/ and started
// life as a verbatim copy of this page's previous implementation. They are
// intentionally independent — there is no shared base — so each can iterate
// without coupling. To drop a variant, remove its entry from VARIANTS and
// delete the file. (Variant C was retired; View A is the default surface.)
// ---------------------------------------------------------------------------
import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AvailabilityViewA } from '@/features/driver-planning/availability/AvailabilityViewA'
import { AvailabilityViewB } from '@/features/driver-planning/availability/AvailabilityViewB'

type VariantKey = 'A' | 'B'

const VARIANTS: { key: VariantKey; label: string; Component: () => React.ReactElement }[] = [
  { key: 'A', label: 'A', Component: AvailabilityViewA },
  { key: 'B', label: 'B', Component: AvailabilityViewB },
]

export function DriverPlanningPage() {
  // View A renders first; after that the user is in control — the tab they click
  // stays put across re-renders.
  const [variant, setVariant] = useState<VariantKey>('A')

  const Active = VARIANTS.find((v) => v.key === variant)!.Component

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <span
          className="text-xs uppercase tracking-wide text-muted-foreground"
          id="availability-change-view-label"
        >
          Change View
        </span>
        <Tabs
          value={variant}
          onValueChange={(v) => setVariant(v as VariantKey)}
          aria-labelledby="availability-change-view-label"
        >
          <TabsList data-testid="availability-view-tabs">
            {VARIANTS.map((v) => (
              <TabsTrigger key={v.key} value={v.key} data-testid={`availability-view-tab-${v.key}`}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <Active />
    </div>
  )
}
