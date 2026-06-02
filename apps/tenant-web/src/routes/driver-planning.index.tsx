// ---------------------------------------------------------------------------
// Availability route — picks one of three view variants (V-A / V-B / V-C) at
// random on mount and exposes a "Change View" tab control in the upper right
// so dispatchers can switch on demand.
//
// Each variant lives under features/driver-planning/availability/ and started
// life as a verbatim copy of this page's previous implementation. They are
// intentionally independent — there is no shared base — so each can iterate
// without coupling. To drop a variant, remove its entry from VARIANTS and
// delete the file.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AvailabilityViewA } from '@/features/driver-planning/availability/AvailabilityViewA'
import { AvailabilityViewB } from '@/features/driver-planning/availability/AvailabilityViewB'
import { AvailabilityViewC } from '@/features/driver-planning/availability/AvailabilityViewC'

type VariantKey = 'A' | 'B' | 'C'

const VARIANTS: { key: VariantKey; label: string; Component: () => React.ReactElement }[] = [
  { key: 'A', label: 'V-A', Component: AvailabilityViewA },
  { key: 'B', label: 'V-B', Component: AvailabilityViewB },
  { key: 'C', label: 'V-C', Component: AvailabilityViewC },
]

function pickRandomVariant(): VariantKey {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)]!.key
}

export function DriverPlanningPage() {
  // Initial pick is randomised once per mount. After that the user is in
  // control — re-renders never reshuffle, so the tab they clicked stays put.
  const [variant, setVariant] = useState<VariantKey>(() => pickRandomVariant())

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
