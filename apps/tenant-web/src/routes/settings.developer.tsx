import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  Key,
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Database,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  apiClientsQueryOptions,
  useCreateApiClient,
  useUpdateApiClient,
  useRevokeApiClient,
  useRotateApiClient,
} from '@/api/queries/api-clients'
import { mssqlSettingsQueryOptions, useUpdateMssqlSettings } from '@/api/queries/settings'
import type { ApiClient, ApiClientWithKey } from '@/api/api-clients'

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

type FormMode = { kind: 'add' } | { kind: 'edit'; client: ApiClient }

type ApiClientFormProps = {
  mode: FormMode
  onDone: () => void
  onCreated: (clientWithKey: ApiClientWithKey) => void
}

function ApiClientForm({ mode, onDone, onCreated }: ApiClientFormProps) {
  const isEdit = mode.kind === 'edit'
  const existing = isEdit ? mode.client : null

  const [name, setName] = useState(existing?.name ?? '')
  const [scopesStr, setScopesStr] = useState(existing?.scopes?.join(', ') ?? '*')
  const [formError, setFormError] = useState<string | null>(null)

  const createMutation = useCreateApiClient()
  const updateMutation = useUpdateApiClient()
  const isPending = createMutation.isPending || updateMutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const scopes = scopesStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (scopes.length === 0) {
      setFormError('At least one scope is required.')
      return
    }

    try {
      if (isEdit && existing) {
        const data: { name?: string; scopes?: string[] } = {}
        if (name !== existing.name) data.name = name

        // Simple array comparison, might not be perfect if unordered but good enough for this
        const existingScopes = [...existing.scopes].sort().join(',')
        const newScopes = [...scopes].sort().join(',')

        if (newScopes !== existingScopes) data.scopes = scopes

        if (Object.keys(data).length > 0) {
          await updateMutation.mutateAsync({ id: existing.id, data })
        }
        onDone()
      } else {
        const data = { name, scopes }
        const created = await createMutation.mutateAsync(data)
        onCreated(created)
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setFormError(message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? 'Edit API Client' : 'Create API Client'}</CardTitle>
        <CardDescription>
          {isEdit
            ? 'Update the name and scopes for this API client.'
            : 'Create a new backend API key. The key will only be shown once.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="space-y-5"
        >
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g. Zapier Integration"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </div>

          {/* Scopes */}
          <div className="space-y-1.5">
            <Label htmlFor="scopes">Scopes</Label>
            <Input
              id="scopes"
              placeholder="e.g. *, read:moves, write:moves"
              value={scopesStr}
              onChange={(e) => setScopesStr(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Comma separated list of scopes. Use `*` for wildcard access.
            </p>
          </div>

          {/* Error */}
          {formError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={14} className="shrink-0" />
              {formError}
            </div>
          )}

          <Separator />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              {isPending && <Loader2 size={14} className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Create API Client'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PlainKey display modal
// ---------------------------------------------------------------------------

function KeyDisplayModal({
  clientWithKey,
  onClose,
}: {
  clientWithKey: ApiClientWithKey
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(clientWithKey.plainKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback or ignore
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md p-6">
        <Card className="border-primary shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              API Key Generated
            </CardTitle>
            <CardDescription>
              This is the only time this API key will be displayed. Please copy it and keep it
              secure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2 mt-4 mb-4">
              <Input value={clientWithKey.plainKey} readOnly className="font-mono bg-muted/50" />
              <Button
                variant="secondary"
                size="icon"
                onClick={copyToClipboard}
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700">
              <strong>Warning:</strong> If you lose this key, you will need to rotate the API client
              to generate a new one.
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={onClose}>
              I have copied the key
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ApiClient row
// ---------------------------------------------------------------------------

type ApiClientRowProps = {
  client: ApiClient
  onEdit: (client: ApiClient) => void
  onRevoke: (client: ApiClient) => void
  onRotate: (client: ApiClient) => void
}

function ApiClientRowItem({ client, onEdit, onRevoke, onRotate }: ApiClientRowProps) {
  const isRevoked = client.revokedAt !== null

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border bg-card px-4 py-3 ${isRevoked ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Key size={18} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{client.name}</span>
            <Badge variant="outline" className="text-xs font-mono">
              {client.keyPrefix}****
            </Badge>
            {isRevoked && (
              <Badge variant="destructive" className="text-xs">
                Revoked
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground flex gap-4">
            <span>
              Scopes: <code className="font-mono ml-1">{client.scopes.join(', ')}</code>
            </span>
            <span>Created: {new Date(client.createdAt).toLocaleDateString()}</span>
            {client.lastUsedAt && (
              <span>Last Used: {new Date(client.lastUsedAt).toLocaleDateString()}</span>
            )}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isRevoked && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => onEdit(client)}
            >
              <Pencil size={13} />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-100"
              onClick={() => onRotate(client)}
            >
              <RefreshCw size={13} />
              Rotate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => onRevoke(client)}
            >
              <Trash2 size={13} />
              Revoke
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Revoke confirmation
// ---------------------------------------------------------------------------

type RevokeConfirmProps = {
  client: ApiClient
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function RevokeConfirm({ client, onConfirm, onCancel, isPending }: RevokeConfirmProps) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Revoke API Client?</CardTitle>
        <CardDescription>
          This will immediately revoke access for <strong>{client.name}</strong>. Any systems using
          this key will no longer be able to authenticate. This action cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending} className="gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}
          Revoke Client
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Rotate confirmation
// ---------------------------------------------------------------------------

type RotateConfirmProps = {
  client: ApiClient
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function RotateConfirm({ client, onConfirm, onCancel, isPending }: RotateConfirmProps) {
  return (
    <Card className="border-amber-500/50">
      <CardHeader>
        <CardTitle className="text-amber-600">Rotate API Key?</CardTitle>
        <CardDescription>
          This will generate a new key for <strong>{client.name}</strong>. The existing key will be
          immediately invalidated. You will be shown the new key once, after which it cannot be
          retrieved.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="default"
          className="bg-amber-600 hover:bg-amber-700 gap-2"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending && <Loader2 size={14} className="animate-spin" />}
          Rotate Key
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// MSSQL Settings section
// ---------------------------------------------------------------------------

function MssqlSettingsSection() {
  const { data: mssqlSettings, isLoading, isError } = useQuery(mssqlSettingsQueryOptions)
  const updateMutation = useUpdateMssqlSettings()

  const [isEditing, setIsEditing] = useState(false)
  const [connectionString, setConnectionString] = useState('')
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setConnectionString(mssqlSettings?.mssqlConnectionString ?? '')
    setError(null)
    setIsEditing(true)
  }

  function cancelEditing() {
    setIsEditing(false)
    setConnectionString('')
    setError(null)
  }

  async function handleSave() {
    setError(null)
    try {
      await updateMutation.mutateAsync({
        mssqlConnectionString: connectionString || null,
      })
      setIsEditing(false)
      setConnectionString('')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setError(message)
    }
  }

  async function handleClear() {
    setError(null)
    try {
      await updateMutation.mutateAsync({ mssqlConnectionString: null })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setError(message)
    }
  }

  function maskConnectionString(value: string): string {
    if (value.length <= 20) return value
    return value.slice(0, 20) + '********'
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database size={18} className="text-muted-foreground" />
          <CardTitle>Legacy Database Connection</CardTitle>
        </div>
        <CardDescription>
          Configure the SQL Server connection string for the legacy application database.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading settings...
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle size={14} className="shrink-0" />
            Failed to load MSSQL settings.
          </div>
        )}

        {!isLoading && !isError && !isEditing && (
          <div className="flex items-center justify-between">
            <div className="text-sm">
              {mssqlSettings?.mssqlConnectionString ? (
                <code className="font-mono text-muted-foreground">
                  {maskConnectionString(mssqlSettings.mssqlConnectionString)}
                </code>
              ) : (
                <span className="text-muted-foreground">Not configured</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {mssqlSettings?.mssqlConnectionString && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => void handleClear()}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending && <Loader2 size={13} className="animate-spin" />}
                  Clear
                </Button>
              )}
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={startEditing}>
                <Pencil size={13} />
                Edit
              </Button>
            </div>
          </div>
        )}

        {isEditing && (
          <div className="space-y-3">
            <Input
              placeholder="Server=myserver;Database=mydb;User Id=sa;Password=..."
              value={connectionString}
              onChange={(e) => setConnectionString(e.target.value)}
              className="font-mono text-sm"
            />

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={cancelEditing}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={updateMutation.isPending}
                className="gap-2"
              >
                {updateMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type PanelState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; client: ApiClient }
  | { kind: 'revoke'; client: ApiClient }
  | { kind: 'rotate'; client: ApiClient }

export function DeveloperSettingsPage() {
  const { data: clients, isLoading, isError } = useQuery(apiClientsQueryOptions)
  const revokeMutation = useRevokeApiClient()
  const rotateMutation = useRotateApiClient()

  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })
  const [newKey, setNewKey] = useState<ApiClientWithKey | null>(null)

  function closePanel() {
    setPanel({ kind: 'none' })
  }

  async function handleRevoke(client: ApiClient) {
    try {
      await revokeMutation.mutateAsync(client.id)
      closePanel()
    } catch {
      // Ignore
    }
  }

  async function handleRotate(client: ApiClient) {
    try {
      const generated = await rotateMutation.mutateAsync(client.id)
      closePanel()
      setNewKey(generated)
    } catch {
      // Ignore
    }
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Developer Settings"
          breadcrumbs={[{ label: 'Settings' }, { label: 'Developer Settings' }]}
        />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading API clients…
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div>
        <PageHeader
          title="Developer Settings"
          breadcrumbs={[{ label: 'Settings' }, { label: 'Developer Settings' }]}
        />
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={16} />
          Failed to load API clients. Please refresh and try again.
        </div>
      </div>
    )
  }

  return (
    <>
      <div>
        <PageHeader
          title="Developer Settings"
          breadcrumbs={[{ label: 'Settings' }, { label: 'Developer Settings' }]}
          action={
            panel.kind !== 'add' && (
              <Button size="sm" className="gap-2" onClick={() => setPanel({ kind: 'add' })}>
                <Plus size={14} />
                Create API Client
              </Button>
            )
          }
        />

        <div className="space-y-3">
          {(!clients || clients.length === 0) && panel.kind === 'none' && (
            <EmptyState
              title="No API Clients"
              description="Create an API Client to integrate external systems with your Pegasus account."
            />
          )}

          {clients?.map((client) => {
            if (panel.kind === 'edit' && panel.client.id === client.id) {
              return (
                <div key={client.id} className="space-y-2">
                  <ApiClientRowItem
                    client={client}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                  />
                  <ApiClientForm
                    mode={{ kind: 'edit', client }}
                    onDone={closePanel}
                    onCreated={() => {}}
                  />
                </div>
              )
            }

            if (panel.kind === 'revoke' && panel.client.id === client.id) {
              return (
                <div key={client.id} className="space-y-2">
                  <ApiClientRowItem
                    client={client}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                  />
                  <RevokeConfirm
                    client={client}
                    onConfirm={() => void handleRevoke(client)}
                    onCancel={closePanel}
                    isPending={revokeMutation.isPending}
                  />
                </div>
              )
            }

            if (panel.kind === 'rotate' && panel.client.id === client.id) {
              return (
                <div key={client.id} className="space-y-2">
                  <ApiClientRowItem
                    client={client}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                  />
                  <RotateConfirm
                    client={client}
                    onConfirm={() => void handleRotate(client)}
                    onCancel={closePanel}
                    isPending={rotateMutation.isPending}
                  />
                </div>
              )
            }

            return (
              <ApiClientRowItem
                key={client.id}
                client={client}
                onEdit={(c) => setPanel({ kind: 'edit', client: c })}
                onRevoke={(c) => setPanel({ kind: 'revoke', client: c })}
                onRotate={(c) => setPanel({ kind: 'rotate', client: c })}
              />
            )
          })}

          {panel.kind === 'add' && (
            <ApiClientForm
              mode={{ kind: 'add' }}
              onDone={closePanel}
              onCreated={(c) => {
                closePanel()
                setNewKey(c)
              }}
            />
          )}
        </div>

        <Separator className="my-6" />

        <MssqlSettingsSection />
      </div>

      {newKey && <KeyDisplayModal clientWithKey={newKey} onClose={() => setNewKey(null)} />}
    </>
  )
}
