// ---------------------------------------------------------------------------
// Itinerary (Operations → Itinerary) route module: one driver's work as the
// driver sees it in the app — longhaul trip activities, orders assigned to
// them on the order itself, and local dispatch job acts, a week at a time,
// grouped by day and then by stop.
//
// A driver is picked as a longhaul driver and/or a local crew, separately
// (plans/todo/driver-itinerary-mobile.md, decision 3): the two are different
// numbering spaces, sometimes different people, and nothing links them, so the
// screen never pairs them for the dispatcher.
//
// Selecting an act selects its order, and the shared ShipmentDetail drawer
// opens exactly as it does on Services; leaving the screen clears it (the Trip
// page mounts the same drawer off the same global `selectedShipment`).
//
// Operations-only (router `beforeLoad` + nav); the API enforces the same gate.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { longhaulDriversQueryOptions } from '@/api/queries/longhaul-drivers'
import {
  driverItineraryQueryOptions,
  itineraryCrewsQueryOptions,
  type ItineraryItem,
  type ItinerarySourceName,
} from '@/api/queries/driver-itinerary'
import { ShipmentDetail } from '../containers/ShipmentDetail'
import { selectShipment } from '../redux/shipments'
import { useAppDispatch } from '../redux/hooks'
import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'
import {
  formatDay,
  formatRange,
  formatWindow,
  groupItinerary,
  localDay,
  rangeFrom,
  shiftRange,
  sourceLabel,
  stopTitle,
} from '../itinerary/itinerary-view'

const SOURCE_LABEL: Record<ItinerarySourceName, string> = {
  longhaul: 'trip activities',
  order: 'order assignments',
  local: 'local jobs',
}

const SELECT_CLASS =
  'h-9 min-w-[16rem] rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'

function idOrNull(value: string): number | null {
  const n = Number(value)
  return value !== '' && Number.isInteger(n) && n > 0 ? n : null
}

export function ItineraryModule() {
  const dispatch = useAppDispatch()
  useEffect(
    () => () => {
      dispatch(selectShipment(null) as any)
    },
    [dispatch],
  )

  const today = localDay()
  const [range, setRange] = useState(() => rangeFrom(today))
  const [longhaulDriverId, setLonghaulDriverId] = useState<number | null>(null)
  const [localDriverEmployeeId, setLocalDriverEmployeeId] = useState<number | null>(null)

  const drivers = useQuery(longhaulDriversQueryOptions)
  const crews = useQuery(itineraryCrewsQueryOptions)
  const picked = longhaulDriverId != null || localDriverEmployeeId != null
  const itinerary = useQuery(
    driverItineraryQueryOptions({ ...range, longhaulDriverId, localDriverEmployeeId }),
  )

  const days = useMemo(() => groupItinerary(itinerary.data?.items ?? []), [itinerary.data])
  const failed = itinerary.data?.failedSources ?? []

  const openOrder = (item: ItineraryItem) =>
    dispatch(selectShipment({ order_num: item.orderNum } as LonghaulShipmentRow) as any)

  return (
    <div className="ItineraryModule__container">
      <div className="App__left-column space-y-4" data-target="itinerary-module">
        <PageHeader title="Itinerary" />

        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">Longhaul driver</span>
            <select
              aria-label="Longhaul driver"
              className={SELECT_CLASS}
              value={longhaulDriverId ?? ''}
              onChange={(e) => setLonghaulDriverId(idOrNull(e.target.value))}
              disabled={drivers.isPending}
            >
              <option value="">— None —</option>
              {drivers.isError && (
                <option value="" disabled>
                  Failed to load drivers
                </option>
              )}
              {(drivers.data ?? [])
                .filter((d) => d.driver_id > 0)
                .map((d) => (
                  <option key={d.driver_id} value={d.driver_id}>
                    {d.driver_name}
                  </option>
                ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">Local crew</span>
            <select
              aria-label="Local crew"
              className={SELECT_CLASS}
              value={localDriverEmployeeId ?? ''}
              onChange={(e) => setLocalDriverEmployeeId(idOrNull(e.target.value))}
              disabled={crews.isPending}
            >
              <option value="">— None —</option>
              {crews.isError && (
                <option value="" disabled>
                  Failed to load crews
                </option>
              )}
              {(crews.data ?? []).map((c) => (
                <option key={c.employeeId} value={c.employeeId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Previous week"
              onClick={() => setRange((r) => shiftRange(r, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span
              className="min-w-[9rem] text-center text-sm font-medium"
              data-target="itinerary-range"
            >
              {formatRange(range)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Next week"
              onClick={() => setRange((r) => shiftRange(r, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={range.from === today}
              onClick={() => setRange(rangeFrom(today))}
            >
              Today
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A driver's longhaul and local work are recorded under different ids. Pick either or both.
        </p>

        {!picked ? (
          <EmptyState
            title="Pick a driver"
            description="Choose a longhaul driver, a local crew, or both to see their work."
          />
        ) : itinerary.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : itinerary.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {(itinerary.error as Error).message || 'Could not load the itinerary.'}
          </p>
        ) : (
          <>
            {failed.length > 0 && (
              <p className="text-sm text-destructive" role="alert">
                Could not load {failed.map((s) => SOURCE_LABEL[s] ?? s).join(' or ')}; this list may
                be missing work.
              </p>
            )}
            {days.length === 0 ? (
              <EmptyState title="Nothing scheduled" description="No work in this week." />
            ) : (
              <div className="space-y-4">
                {days.map((d) => (
                  <section key={d.day} className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      {formatDay(d.day)}
                      {d.day === today ? ' · Today' : ''}
                    </h3>
                    {d.stops.map((stop) => (
                      <div key={stop.key} className="rounded-md border p-3">
                        <p className="text-sm font-medium">{stopTitle(stop)}</p>
                        <ul className="mt-2 divide-y">
                          {stop.items.map((item) => (
                            <li key={item.key}>
                              <button
                                type="button"
                                className="flex w-full items-start justify-between gap-3 py-2 text-left hover:bg-muted/50"
                                onClick={() => openOrder(item)}
                                data-testid="itinerary-act"
                              >
                                <span>
                                  <span className="block text-sm font-medium">
                                    {item.actual ? '✓ ' : ''}
                                    {item.actName}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    #{item.orderNum}
                                    {item.shipperName ? ` · ${item.shipperName}` : ''}
                                    {item.arrivalWindow
                                      ? ` · Arrive ${formatWindow(item.arrivalWindow)}`
                                      : ''}
                                  </span>
                                </span>
                                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                                  <Badge variant="outline">{sourceLabel(item)}</Badge>
                                  {item.tripStatus && (
                                    <Badge variant="secondary">{item.tripStatus}</Badge>
                                  )}
                                  {item.kind === 'storage' && (
                                    <Badge variant="outline">Storage</Badge>
                                  )}
                                  {item.confirmed && !item.actual && <Badge>Confirmed</Badge>}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <ShipmentDetail />
    </div>
  )
}
