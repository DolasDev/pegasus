// ---------------------------------------------------------------------------
// Service-area editor — the cities a crew works, with a typeahead over
// GET /labor/places (US + Canada; "spring" or "spring, mo").
//
// Edits are staged locally and saved as one PUT, which REPLACES the shared
// list. That is why a concurrent save by someone else comes back as a 409
// (SERVICE_AREAS_CONFLICT) rather than merging.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notifySuccess } from '../components/Snackbar/notify'
import { placesQueryOptions, useSaveServiceAreas, type LaborServiceArea } from '@/api/queries/labor'
import { useDebounce } from '../utils/hooks/use-debounce'
import { FormError } from './dialogs'
import { laborErrorMessage } from './labor-errors'

interface Area {
  city: string
  region: string
}

const keyOf = (a: Area) => `${a.city.toLowerCase()}|${a.region}`

export function ServiceAreaEditor({
  phone,
  serviceAreas,
}: {
  phone: string
  serviceAreas: LaborServiceArea[]
}) {
  const save = useSaveServiceAreas(phone)
  const saved: Area[] = serviceAreas.map(({ city, region }) => ({ city, region }))
  const [areas, setAreas] = useState<Area[]>(saved)
  const [typed, setTyped] = useState('')
  const q = useDebounce(typed.trim(), 250)
  const places = useQuery({ ...placesQueryOptions(q), enabled: q.replace(/,.*/, '').length >= 2 })

  const dirty = areas.map(keyOf).join(',') !== saved.map(keyOf).join(',')

  function add(place: Area) {
    if (!areas.some((a) => keyOf(a) === keyOf(place))) {
      setAreas([...areas, { city: place.city, region: place.region }])
    }
    setTyped('')
  }

  async function onSave() {
    try {
      const next = await save.mutateAsync(areas)
      setAreas(next.serviceAreas.map(({ city, region }) => ({ city, region })))
      notifySuccess('Service areas saved')
    } catch {
      // Rendered below from save.error.
    }
  }

  const suggestions = (places.data ?? []).filter((p) => !areas.some((a) => keyOf(a) === keyOf(p)))

  return (
    <section className="space-y-2" aria-labelledby="labor-areas-heading">
      <h3 id="labor-areas-heading" className="text-sm font-semibold">
        Service areas
      </h3>
      {areas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No service areas yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" data-testid="labor-area-list">
          {areas.map((a) => (
            <li
              key={keyOf(a)}
              className="flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm"
            >
              {a.city}, {a.region}
              <button
                type="button"
                aria-label={`Remove ${a.city}, ${a.region}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setAreas(areas.filter((x) => keyOf(x) !== keyOf(a)))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Input
          aria-label="Add a city"
          placeholder="Add a city, e.g. Springfield, MO"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          data-testid="labor-area-input"
        />
        {suggestions.length > 0 && typed.trim() === q && (
          <ul
            className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-background shadow"
            data-testid="labor-area-suggestions"
          >
            {suggestions.map((p) => (
              <li key={keyOf(p)}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => add(p)}
                >
                  {p.city}, {p.region}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <FormError message={save.isError ? laborErrorMessage(save.error) : null} />
      {dirty && (
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save service areas'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              setAreas(saved)
              save.reset()
            }}
          >
            Discard
          </Button>
        </div>
      )}
    </section>
  )
}
