import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Folder,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/api/client'
import {
  secretsQueryOptions,
  configsQueryOptions,
  useCreateSecret,
  useDeleteSecret,
  useCreateConfig,
  useUpsertConfig,
  useDeleteConfig,
} from '@/api/queries/workflow-secrets-configs'
import {
  DEFAULT_GROUP,
  type WorkflowSecretMeta,
  type WorkflowConfigEntry,
} from '@/api/workflow-secrets-configs'
import { usePermissions } from '@/auth/permissions'
import {
  consumersOf,
  missingVariables,
  usageKey,
  useVariableUsage,
  type VariableConsumer,
  type VariableUsage,
  type VariableUsageIndex,
} from './variable-usage'

// Cedar permissions (underscore, not hyphen — the /me/permissions contract only
// allows [a-z_]+:[a-z_]+ strings).
const MANAGE_SECRETS_PERMISSION = 'workflow_secret:manage'
const MANAGE_CONFIGS_PERMISSION = 'workflow_config:manage'

/** Env-var-style key rule — mirrors the server's KEY_RE. */
const SECRET_CONFIG_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/

/** Group name rule — mirrors the server's GROUP_RE. */
const SECRET_CONFIG_GROUP_RE = /^[a-zA-Z0-9_-]{1,64}$/

// ---------------------------------------------------------------------------
// Secrets & configuration
// ---------------------------------------------------------------------------

function keyError(key: string): string | null {
  if (key.length === 0) return 'Key is required.'
  if (!SECRET_CONFIG_KEY_RE.test(key)) {
    return 'Key must start with a letter or _ and use only letters, digits, and _ (max 128).'
  }
  return null
}

/** Normalize a group input: blank → the default "global" bucket. */
function normalizeGroup(group: string): string {
  return group.trim() || DEFAULT_GROUP
}

function groupError(group: string): string | null {
  if (!SECRET_CONFIG_GROUP_RE.test(normalizeGroup(group))) {
    return 'Group must use only letters, digits, - and _ (max 64).'
  }
  return null
}

/**
 * Bucket entries by their group for grouped rendering. The default "global"
 * group sorts first; the rest alphabetically. Entries keep the server's key
 * order within each group.
 */
function groupByGroup<T extends { group: string }>(items: T[]): [string, T[]][] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const arr = buckets.get(item.group)
    if (arr) arr.push(item)
    else buckets.set(item.group, [item])
  }
  return [...buckets.entries()].sort(([a], [b]) => {
    if (a === DEFAULT_GROUP) return -1
    if (b === DEFAULT_GROUP) return 1
    return a.localeCompare(b)
  })
}

/** A group heading row shown above each group's entries. */
function GroupHeading({ group, count }: { group: string; count: number }) {
  return (
    <div className="flex items-center gap-2 bg-muted/40 px-4 py-1.5">
      <Folder className="h-3 w-3 text-muted-foreground" />
      <span className="font-mono text-xs font-medium text-foreground">{group}</span>
      <Badge variant="outline" className="text-[10px]">
        {count}
      </Badge>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cross-reference rendering
// ---------------------------------------------------------------------------

/**
 * A create-form prefill handed down from the missing-variables panel, so filling
 * a declared-but-unset key means typing only its value. `nonce` guarantees a
 * fresh object identity even when two different clicks carry identical fields —
 * the sections apply this via an identity-keyed effect.
 */
interface AddPrefill {
  kind: 'SECRET' | 'CONFIG'
  key: string
  group: string
  description: string | null
  nonce: number
}

/** Deep-link one consumer to the page where it is managed. */
function ConsumerLink({ consumer }: { consumer: VariableConsumer }) {
  return consumer.type === 'workflow' ? (
    <Link
      to="/settings/workflows/$workflowId"
      params={{ workflowId: consumer.id }}
      className="text-primary hover:underline"
    >
      {consumer.name}
    </Link>
  ) : (
    <Link
      to="/integrations/$integrationId"
      params={{ integrationId: consumer.id }}
      className="text-primary hover:underline"
    >
      {consumer.name}
    </Link>
  )
}

/** How many consumer names to spell out before collapsing into "+N more". */
const CONSUMERS_SHOWN = 3

/**
 * "Used by X, Y" for one stored entry. Renders nothing when nothing declares the
 * key — which also covers the fail-open case where the caller cannot read the
 * requirements summaries at all.
 */
function UsedBy({
  consumers,
  label = 'Used by',
  className,
}: {
  consumers: VariableConsumer[]
  label?: string
  className?: string
}) {
  if (consumers.length === 0) return null
  const shown = consumers.slice(0, CONSUMERS_SHOWN)
  const overflow = consumers.slice(CONSUMERS_SHOWN)

  return (
    <span className={`text-xs text-muted-foreground ${className ?? ''}`}>
      {label}{' '}
      {shown.map((c, i) => (
        <span key={`${c.type}:${c.id}`}>
          <ConsumerLink consumer={c} />
          {i < shown.length - 1 ? ', ' : ''}
        </span>
      ))}
      {overflow.length > 0 && (
        <span title={overflow.map((c) => c.name).join(', ')}> +{overflow.length} more</span>
      )}
    </span>
  )
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

function ConfirmDeleteDialog({
  what,
  name,
  consumers,
  onConfirm,
  onClose,
  pending,
}: {
  what: string
  name: string
  /** Everything that declared it reads this key — named so the blast radius is explicit. */
  consumers: VariableConsumer[]
  onConfirm: () => void
  onClose: () => void
  pending: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Delete ${what}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-destructive">Delete {what}?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-mono">{name}</span> will be permanently removed. Anything that reads
          it will fail until it is recreated. This cannot be undone.
        </p>
        {consumers.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                {consumers.length}{' '}
                {consumers.length === 1 ? 'consumer declares' : 'consumers declare'} this key and
                will fail at runtime:{' '}
                <span className="font-medium">{consumers.map((c) => c.name).join(', ')}</span>
              </span>
            </p>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function SecretsSection({
  usage,
  prefill,
}: {
  usage: VariableUsageIndex
  prefill: AddPrefill | null
}) {
  const perms = usePermissions()
  const canManage = perms.has(MANAGE_SECRETS_PERMISSION)
  const { data, isPending, isError, error } = useQuery({
    ...secretsQueryOptions,
    enabled: canManage,
  })
  const createMutation = useCreateSecret()
  const deleteMutation = useDeleteSecret()

  const [addOpen, setAddOpen] = useState(false)
  const [key, setKey] = useState('')
  const [group, setGroup] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSecretMeta | null>(null)
  const valueRef = useRef<HTMLInputElement | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  // Adopt a prefill from the missing-variables panel: open the form with the
  // declared key/group/description filled so only the value is left to type.
  // Keyed on the prefill's identity (its nonce keeps that fresh), so clicking
  // Add on a second key re-applies even when the fields happen to match.
  useEffect(() => {
    if (!prefill || prefill.kind !== 'SECRET') return
    setKey(prefill.key)
    setGroup(prefill.group === DEFAULT_GROUP ? '' : prefill.group)
    setDescription(prefill.description ?? '')
    setValue('')
    setFormError(null)
    setAddOpen(true)
    setFocusTick((t) => t + 1)
  }, [prefill])

  // Runs on the commit AFTER the form is opened, so the input exists by now.
  useEffect(() => {
    if (focusTick === 0) return
    valueRef.current?.focus()
    valueRef.current?.scrollIntoView?.({ block: 'center' })
  }, [focusTick])

  if (!canManage) return null

  function resetForm() {
    setKey('')
    setGroup('')
    setValue('')
    setDescription('')
    setFormError(null)
    setAddOpen(false)
  }

  function handleCreate() {
    const ke = keyError(key)
    if (ke) {
      setFormError(ke)
      return
    }
    const ge = groupError(group)
    if (ge) {
      setFormError(ge)
      return
    }
    if (value.length === 0) {
      setFormError('Value is required.')
      return
    }
    createMutation.mutate(
      {
        key,
        value,
        group: normalizeGroup(group),
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      {
        onSuccess: () => resetForm(),
        onError: (e) => setFormError(apiErrorMessage(e, 'Failed to create secret.')),
      },
    )
  }

  const secrets = data ?? []
  const grouped = groupByGroup(secrets)

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Secrets</h2>
        <Badge variant="secondary" className="text-xs">
          {secrets.length}
        </Badge>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => setAddOpen((o) => !o)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add secret
          </Button>
        </div>
      </div>
      <Separator className="mb-3" />
      <p className="mb-3 text-xs text-muted-foreground">
        Encrypted, write-once values your workflows read at runtime via{' '}
        <code className="font-mono">get_secret()</code>. Values are never shown again after creation
        — to rotate, delete and recreate. A workflow must declare{' '}
        <code className="font-mono">ReadWorkflowSecret</code> in its manifest. Organize related keys
        into <span className="font-medium">groups</span>; anything left ungrouped lives in{' '}
        <code className="font-mono">{DEFAULT_GROUP}</code>.
      </p>

      {addOpen && (
        <div className="mb-3 rounded-md border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="secret-key" className="block text-xs font-medium text-foreground">
                Key
              </label>
              <Input
                id="secret-key"
                className="mt-1 font-mono"
                placeholder="STRIPE_API_KEY"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="secret-group" className="block text-xs font-medium text-foreground">
                Group
              </label>
              <Input
                id="secret-group"
                className="mt-1 font-mono"
                placeholder={DEFAULT_GROUP}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="secret-value" className="block text-xs font-medium text-foreground">
              Value
            </label>
            <Input
              id="secret-value"
              ref={valueRef}
              type="password"
              className="mt-1 font-mono"
              placeholder="sk_live_…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="mt-3">
            <label htmlFor="secret-desc" className="block text-xs font-medium text-foreground">
              Description (optional)
            </label>
            <Input
              id="secret-desc"
              className="mt-1"
              placeholder="What this is for"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {formError && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetForm}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Create secret
            </Button>
          </div>
        </div>
      )}

      {isPending ? (
        <div className="flex items-center py-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading secrets…
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">
          {apiErrorMessage(error, 'Failed to load secrets.')}
        </p>
      ) : secrets.length === 0 ? (
        <EmptyState
          title="No secrets"
          description="Add a secret your workflows can read at runtime."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {grouped.map(([groupName, rows]) => (
            <div key={groupName} className="border-b border-border last:border-b-0">
              <GroupHeading group={groupName} count={rows.length} />
              {rows.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 border-t border-border px-4 py-3"
                >
                  <code className="shrink-0 font-mono text-sm text-foreground">{s.key}</code>
                  {s.description && (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {s.description}
                    </span>
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <UsedBy consumers={consumersOf(usage, 'SECRET', s.group, s.key)} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog
          what="secret"
          name={`${deleteTarget.key} (${deleteTarget.group})`}
          consumers={consumersOf(usage, 'SECRET', deleteTarget.group, deleteTarget.key)}
          pending={deleteMutation.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteMutation.mutate(
              { key: deleteTarget.key, group: deleteTarget.group },
              { onSuccess: () => setDeleteTarget(null) },
            )
          }
        />
      )}
    </section>
  )
}

function ConfigsSection({
  usage,
  prefill,
}: {
  usage: VariableUsageIndex
  prefill: AddPrefill | null
}) {
  const perms = usePermissions()
  const canManage = perms.has(MANAGE_CONFIGS_PERMISSION)
  const { data, isPending, isError, error } = useQuery({
    ...configsQueryOptions,
    enabled: canManage,
  })
  const createMutation = useCreateConfig()
  const upsertMutation = useUpsertConfig()
  const deleteMutation = useDeleteConfig()

  const [addOpen, setAddOpen] = useState(false)
  const [key, setKey] = useState('')
  const [group, setGroup] = useState('')
  const [value, setValue] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WorkflowConfigEntry | null>(null)
  const valueRef = useRef<HTMLInputElement | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  // Adopt a prefill from the missing-variables panel — see the twin effect in
  // SecretsSection. The config form carries no description field, so a declared
  // description stays where the user can see it (the missing-variables row)
  // rather than being sent along invisibly.
  useEffect(() => {
    if (!prefill || prefill.kind !== 'CONFIG') return
    setKey(prefill.key)
    setGroup(prefill.group === DEFAULT_GROUP ? '' : prefill.group)
    setValue('')
    setFormError(null)
    setAddOpen(true)
    setFocusTick((t) => t + 1)
  }, [prefill])

  useEffect(() => {
    if (focusTick === 0) return
    valueRef.current?.focus()
    valueRef.current?.scrollIntoView?.({ block: 'center' })
  }, [focusTick])

  if (!canManage) return null

  function resetForm() {
    setKey('')
    setGroup('')
    setValue('')
    setFormError(null)
    setAddOpen(false)
  }

  function handleCreate() {
    const ke = keyError(key)
    if (ke) {
      setFormError(ke)
      return
    }
    const ge = groupError(group)
    if (ge) {
      setFormError(ge)
      return
    }
    createMutation.mutate(
      { key, value, group: normalizeGroup(group) },
      {
        onSuccess: () => resetForm(),
        onError: (e) => setFormError(apiErrorMessage(e, 'Failed to create config entry.')),
      },
    )
  }

  function handleSaveEdit(entry: WorkflowConfigEntry) {
    // Pass the entry's own group so the upsert targets the right row (the same
    // key can exist in multiple groups).
    upsertMutation.mutate(
      { key: entry.key, data: { value: editValue, group: entry.group } },
      { onSuccess: () => setEditId(null) },
    )
  }

  const configs = data ?? []
  const grouped = groupByGroup(configs)

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Configuration</h2>
        <Badge variant="secondary" className="text-xs">
          {configs.length}
        </Badge>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => setAddOpen((o) => !o)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add config
          </Button>
        </div>
      </div>
      <Separator className="mb-3" />
      <p className="mb-3 text-xs text-muted-foreground">
        Plain, editable key/value pairs your workflows read at runtime via{' '}
        <code className="font-mono">get_config()</code>. A workflow must declare{' '}
        <code className="font-mono">ReadWorkflowConfig</code> in its manifest. Organize related keys
        into <span className="font-medium">groups</span>; anything left ungrouped lives in{' '}
        <code className="font-mono">{DEFAULT_GROUP}</code>.
      </p>

      {addOpen && (
        <div className="mb-3 rounded-md border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="config-key" className="block text-xs font-medium text-foreground">
                Key
              </label>
              <Input
                id="config-key"
                className="mt-1 font-mono"
                placeholder="DEFAULT_REGION"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="config-group" className="block text-xs font-medium text-foreground">
                Group
              </label>
              <Input
                id="config-group"
                className="mt-1 font-mono"
                placeholder={DEFAULT_GROUP}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="config-value" className="block text-xs font-medium text-foreground">
              Value
            </label>
            <Input
              id="config-value"
              ref={valueRef}
              className="mt-1 font-mono"
              placeholder="us-east-1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          {formError && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {formError}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={resetForm}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Create config
            </Button>
          </div>
        </div>
      )}

      {isPending ? (
        <div className="flex items-center py-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading configuration…
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">
          {apiErrorMessage(error, 'Failed to load configuration.')}
        </p>
      ) : configs.length === 0 ? (
        <EmptyState
          title="No configuration"
          description="Add a config value your workflows can read."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {grouped.map(([groupName, rows]) => (
            <div key={groupName} className="border-b border-border last:border-b-0">
              <GroupHeading group={groupName} count={rows.length} />
              {rows.map((cfg) => (
                <div
                  key={cfg.id}
                  className="flex items-center gap-3 border-t border-border px-4 py-3"
                >
                  <code className="shrink-0 font-mono text-sm text-foreground">{cfg.key}</code>
                  {editId === cfg.id ? (
                    <>
                      <Input
                        className="font-mono"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSaveEdit(cfg)}
                        disabled={upsertMutation.isPending}
                      >
                        Save
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
                        {cfg.value}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <UsedBy consumers={consumersOf(usage, 'CONFIG', cfg.group, cfg.key)} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditId(cfg.id)
                            setEditValue(cfg.value)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(cfg)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog
          what="config entry"
          name={`${deleteTarget.key} (${deleteTarget.group})`}
          consumers={consumersOf(usage, 'CONFIG', deleteTarget.group, deleteTarget.key)}
          pending={deleteMutation.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteMutation.mutate(
              { key: deleteTarget.key, group: deleteTarget.group },
              { onSuccess: () => setDeleteTarget(null) },
            )
          }
        />
      )}
    </section>
  )
}

/**
 * The keys workflows and integrations declared but this tenant has not set,
 * listed KEY-first (one row per key, however many things want it) with who needs
 * each one. "Add" prefills that key's create form so only the value is left to
 * type. Silent when nothing is missing — or when neither summary can be read,
 * since the index is then empty.
 */
function MissingVariablesPanel({
  usage,
  onAdd,
}: {
  usage: VariableUsageIndex
  onAdd: (variable: VariableUsage) => void
}) {
  const perms = usePermissions()
  const missing = missingVariables(usage)
  if (missing.length === 0) return null

  // Mirror how the sections self-hide: only offer Add for the kind this user can
  // actually manage.
  function canAdd(kind: 'SECRET' | 'CONFIG'): boolean {
    return perms.has(kind === 'SECRET' ? MANAGE_SECRETS_PERMISSION : MANAGE_CONFIGS_PERMISSION)
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TriangleAlert className="h-4 w-4 text-amber-600" />
        {missing.length} key{missing.length === 1 ? '' : 's'} declared but not set
      </h3>
      <ul className="mt-3 space-y-2">
        {missing.map((variable) => (
          <li
            key={usageKey(variable.kind, variable.group, variable.key)}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <code className="font-mono text-xs text-foreground">{variable.key}</code>
            <Badge variant="outline" className="text-[10px]">
              {variable.kind === 'SECRET' ? 'secret' : 'config'}
            </Badge>
            {variable.group !== DEFAULT_GROUP && (
              <span className="font-mono text-xs text-muted-foreground">{variable.group}</span>
            )}
            {variable.description && (
              <span className="text-xs text-muted-foreground">{variable.description}</span>
            )}
            <UsedBy consumers={variable.consumers} label="Needed by" />
            {canAdd(variable.kind) && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => onAdd(variable)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Per-tenant secrets & configuration the workflows read at runtime. Each section
 * self-hides if the user lacks its manage permission; if the user can manage
 * neither, the whole panel shows a no-access note.
 *
 * The cross-reference index is built once here and threaded down, so both
 * sections and the missing-variables panel read one pair of summary queries.
 */
export function WorkflowSecretsConfigsPanel() {
  const perms = usePermissions()
  const canAny = perms.has(MANAGE_SECRETS_PERMISSION) || perms.has(MANAGE_CONFIGS_PERMISSION)
  const usage = useVariableUsage()
  const [prefill, setPrefill] = useState<AddPrefill | null>(null)
  const nonce = useRef(0)

  if (!canAny) {
    return (
      <EmptyState
        title="No access"
        description="You don't have permission to manage workflow secrets or configuration. Ask a tenant admin for the workflow_secret:manage or workflow_config:manage permission."
      />
    )
  }

  return (
    <div className="space-y-8">
      <MissingVariablesPanel
        usage={usage}
        onAdd={(variable) =>
          setPrefill({
            kind: variable.kind,
            key: variable.key,
            group: variable.group,
            description: variable.description,
            nonce: ++nonce.current,
          })
        }
      />
      <SecretsSection usage={usage} prefill={prefill} />
      <ConfigsSection usage={usage} prefill={prefill} />
    </div>
  )
}
