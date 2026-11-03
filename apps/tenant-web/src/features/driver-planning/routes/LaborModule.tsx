// ---------------------------------------------------------------------------
// Labor (Operations → Labor) route module: the tenant's company crew list.
//
// The company list is the set of cash-labor crews every driver at the tenant
// can assign to an order's activities in the mobile app. Single column:
//   - a debounced search box with the API's query semantics (see HELP);
//   - a table that opens a crew's detail drawer, and a New crew dialog.
//
// Operations-only (router `beforeLoad` + nav). The API enforces the same gate
// on removing a crew and creating one by phone; everyone else at the tenant
// edits company crews from the mobile app.
//
// The selected crew lives in local state, not the URL: the Redux store this
// layout mounts holds nothing for it, and a phone number is not something to
// put in a shareable link.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { companyCrewsQueryOptions, type LaborCrew } from '@/api/queries/labor'
import { CrewDetailDrawer } from '../labor/CrewDetailDrawer'
import { laborErrorMessage } from '../labor/labor-errors'
import { NewCrewDialog } from '../labor/NewCrewDialog'
import { useDebounce } from '../utils/hooks/use-debounce'

const SEARCH_DEBOUNCE_MS = 300

const HELP =
  'Leave blank for A–Z. Enter a ZIP / postal code or "City, ST" to sort by distance, a state or ' +
  'province code (MO, ON) to filter, or a name, nickname or phone number.'

function averageLabel(crew: LaborCrew): string {
  const avg = crew.averageRating
  return avg ? `${avg.average.toFixed(1)} (${avg.count})` : '—'
}

export function LaborModule() {
  const [search, setSearch] = useState('')
  const q = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const list = useQuery({ ...companyCrewsQueryOptions(q), placeholderData: (prev) => prev })
  const crews = list.data?.crews ?? []
  const meta = list.data?.meta
  const showDistance = crews.some((c) => c.distanceMiles !== undefined)

  return (
    <div className="space-y-4" data-target="labor-module">
      <PageHeader
        title="Labor"
        action={
          <Button type="button" onClick={() => setCreating(true)} data-testid="labor-new-crew">
            <Plus className="h-4 w-4" />
            New crew
          </Button>
        }
      />

      <div className="space-y-1">
        <Input
          type="search"
          aria-label="Search crews"
          placeholder="Search crews by name, phone, ZIP or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
          data-testid="labor-search"
        />
        <p className="text-xs text-muted-foreground">{HELP}</p>
        {meta?.locationNotFound && (
          <p className="text-xs text-destructive" role="status">
            No match for that location, so the list is not sorted by distance.
          </p>
        )}
        {showDistance && meta?.location?.label && (
          <p className="text-xs text-muted-foreground" data-testid="labor-location">
            Nearest first from {meta.location.label}.
          </p>
        )}
      </div>

      {list.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {laborErrorMessage(list.error)}
        </p>
      ) : crews.length === 0 ? (
        <EmptyState
          title={q ? 'No crews match' : 'No crews on the company list'}
          description={
            q
              ? 'Try a different name, phone number or location.'
              : 'Add a crew with New crew, or from the mobile app.'
          }
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Crew</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Service areas</TableHead>
                <TableHead className="text-right">Packers</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                {showDistance && <TableHead className="text-right">Distance</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {crews.map((crew) => (
                <TableRow
                  key={crew.phone}
                  className="cursor-pointer"
                  data-testid="labor-crew-row"
                  onClick={() => setSelected(crew.phone)}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(crew.phone)
                      }}
                    >
                      {crew.displayName}
                    </button>
                    {crew.displayName !== crew.name && (
                      <p className="text-xs text-muted-foreground">{crew.name}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{crew.phoneDisplay}</TableCell>
                  <TableCell>
                    {crew.serviceAreas.length === 0
                      ? '—'
                      : crew.serviceAreas.map((a) => `${a.city}, ${a.region}`).join('; ')}
                  </TableCell>
                  <TableCell className="text-right">{crew.packerCount}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {averageLabel(crew)}
                  </TableCell>
                  {showDistance && (
                    <TableCell className="text-right whitespace-nowrap">
                      {crew.distanceMiles == null ? '—' : `${Math.round(crew.distanceMiles)} mi`}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewCrewDialog open={creating} onOpenChange={setCreating} onOpenCrew={setSelected} />
      <CrewDetailDrawer phone={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
