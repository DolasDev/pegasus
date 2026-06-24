import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApiError } from '@/api/client'
import { usePermissions } from '@/auth/permissions'
import { DOMAIN_EVENT_TYPES } from '@/api/workflows'
import type { TenantEventType, CreateEventTypeInput } from '@/api/event-types'
import {
  eventTypesQueryOptions,
  useCreateEventType,
  useDeleteEventType,
  useUpdateEventType,
} from '@/api/queries/event-types'
import { parseTriggerFilter } from '@/lib/trigger-filter'

const MANAGE_PERMISSION = 'event_type:manage'
const NAME_RE = /^[a-z][a-z0-9_.-]{0,127}$/

const selectClass =
  'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'
const inputClass =
  'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'
const textareaClass =
  'mt-1 h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

function CreateEventTypeDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [schemaText, setSchemaText] = useState('')
  const [conditionEnabled, setConditionEnabled] = useState(false)
  const [sourceEventType, setSourceEventType] = useState<string>(DOMAIN_EVENT_TYPES[0])
  const [conditionFilterText, setConditionFilterText] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const createMutation = useCreateEventType()

  const serverError = createMutation.error
    ? createMutation.error instanceof ApiError
      ? createMutation.error.message
      : 'Failed to create event type.'
    : null

  function handleCreate() {
    setFormError(null)
    if (!NAME_RE.test(name)) {
      setFormError('Name must be a lowercase slug, e.g. "lead.qualified".')
      return
    }
    const input: CreateEventTypeInput = { name }
    if (description.trim()) input.description = description.trim()

    if (schemaText.trim()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(schemaText)
      } catch {
        setFormError('Payload schema must be valid JSON.')
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setFormError('Payload schema must be a JSON object.')
        return
      }
      input.payloadSchema = parsed as Record<string, unknown>
    }

    if (conditionEnabled) {
      const validation = parseTriggerFilter(conditionFilterText)
      if (!validation.ok) {
        setFormError(`Condition filter: ${validation.error}`)
        return
      }
      input.domainCondition = {
        sourceEventType,
        ...(validation.filter ? { filter: validation.filter } : {}),
      }
    }

    createMutation.mutate(input, { onSuccess: () => onClose() })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New custom event type"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Plus className="h-4 w-4" />
          New custom event type
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Define an event your workflows can trigger on. Emit it from an external system, a
          workflow, or automatically from a Pegasus domain condition.
        </p>

        <label htmlFor="et-name" className="mt-4 block text-xs font-medium text-foreground">
          Name
        </label>
        <input
          id="et-name"
          type="text"
          className={inputClass}
          value={name}
          spellCheck={false}
          placeholder="lead.qualified"
          onChange={(e) => setName(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Lowercase letters, digits, <code className="font-mono">. _ -</code>. Must not collide with
          a built-in event name.
        </p>

        <label htmlFor="et-description" className="mt-4 block text-xs font-medium text-foreground">
          Description (optional)
        </label>
        <input
          id="et-description"
          type="text"
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <label htmlFor="et-schema" className="mt-4 block text-xs font-medium text-foreground">
          Payload schema (optional JSON Schema)
        </label>
        <textarea
          id="et-schema"
          className={textareaClass}
          value={schemaText}
          spellCheck={false}
          placeholder='{"type":"object","properties":{"leadId":{"type":"string"}},"required":["leadId"]}'
          onChange={(e) => setSchemaText(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          When set, emit payloads are validated against it. Leave empty for a free-form payload.
        </p>

        <label className="mt-4 flex items-center gap-2 text-xs font-medium text-foreground">
          <input
            type="checkbox"
            checked={conditionEnabled}
            onChange={(e) => setConditionEnabled(e.target.checked)}
          />
          Auto-emit from a Pegasus domain condition
        </label>

        {conditionEnabled && (
          <div className="mt-2 rounded-md border border-border p-3">
            <label htmlFor="et-source" className="block text-xs font-medium text-foreground">
              When this built-in event fires
            </label>
            <select
              id="et-source"
              className={selectClass}
              value={sourceEventType}
              onChange={(e) => setSourceEventType(e.target.value)}
            >
              {DOMAIN_EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label
              htmlFor="et-cond-filter"
              className="mt-3 block text-xs font-medium text-foreground"
            >
              And matches this filter (optional JSON)
            </label>
            <textarea
              id="et-cond-filter"
              className={textareaClass}
              value={conditionFilterText}
              spellCheck={false}
              placeholder='{"path":"newStatus","op":"eq","value":"COMPLETED"}'
              onChange={(e) => setConditionFilterText(e.target.value)}
            />
          </div>
        )}

        {(formError || serverError) && (
          <p className="mt-3 text-sm text-destructive">{formError ?? serverError}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function EventTypeCard({
  eventType,
  canManage,
}: {
  eventType: TenantEventType
  canManage: boolean
}) {
  const updateMutation = useUpdateEventType()
  const deleteMutation = useDeleteEventType()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-mono text-sm">{eventType.name}</CardTitle>
            {eventType.description && (
              <CardDescription className="mt-1">{eventType.description}</CardDescription>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={eventType.enabled ? 'default' : 'secondary'}>
                {eventType.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              {eventType.payloadSchema && <Badge variant="outline">Schema</Badge>}
              {eventType.domainCondition && <Badge variant="outline">Auto-derived</Badge>}
            </div>
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={updateMutation.isPending}
                onClick={() =>
                  updateMutation.mutate({
                    name: eventType.name,
                    input: { enabled: !eventType.enabled },
                  })
                }
              >
                {eventType.enabled ? 'Disable' : 'Enable'}
              </Button>
              {confirmingDelete ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(eventType.name)}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${eventType.name}`}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EventTypesSettingsPage() {
  const perms = usePermissions()
  const canManage = perms.has(MANAGE_PERMISSION)
  const { data, isPending, isError, error } = useQuery(eventTypesQueryOptions)
  const [showCreate, setShowCreate] = useState(false)

  const createButton =
    !perms.isLoading && canManage ? (
      <Button onClick={() => setShowCreate(true)}>
        <Plus className="mr-2 h-4 w-4" />
        New event type
      </Button>
    ) : undefined

  return (
    <div>
      <PageHeader
        title="Event Types"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Event Types' }]}
        action={createButton}
      />

      <p className="mt-2 text-sm text-muted-foreground">
        Custom events extend the built-in taxonomy that{' '}
        <Link to="/settings/workflows" className="text-primary hover:underline">
          workflows
        </Link>{' '}
        can trigger on. Author and push them with the{' '}
        <Link to="/settings/developer" className="text-primary hover:underline">
          SDK
        </Link>
        .
      </p>

      <div className="mt-6">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load event types.'}
          </p>
        ) : data.length === 0 ? (
          <EmptyState
            title="No custom event types"
            description="Define an event your workflows can trigger on, beyond the built-in ones."
            action={createButton}
          />
        ) : (
          <div className="space-y-3">
            {data.map((et) => (
              <EventTypeCard key={et.id} eventType={et} canManage={canManage} />
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateEventTypeDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}
