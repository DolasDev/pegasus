import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Plus,
  Pencil,
  Trash2,
  Ban,
  Key,
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  Database,
  Terminal,
  ExternalLink,
  Stethoscope,
  CheckCircle2,
  Package,
  Building2,
  Server,
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
  useDeleteApiClient,
} from '@/api/queries/api-clients'
import {
  mssqlSettingsQueryOptions,
  useUpdateMssqlSettings,
  useTestMssqlConnection,
  useTestPegiiConnection,
} from '@/api/queries/settings'
import type { MssqlTestResult, PegiiTestResult } from '@/api/settings'
import { roleOptionsQueryOptions, type RoleOption } from '@/api/queries/users'
import type { ApiClient, ApiClientWithKey } from '@/api/api-clients'
import { getConfig } from '@/config'
import { getSession } from '@/auth/session'
import { usePermissions } from '@/auth/permissions'
import { RoleCheckboxList } from '@/components/RoleCheckboxList'

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

type FormMode = { kind: 'add' } | { kind: 'edit'; client: ApiClient }

type ApiClientFormProps = {
  mode: FormMode
  roleOptions: RoleOption[]
  onDone: () => void
  onCreated: (clientWithKey: ApiClientWithKey) => void
}

/** Default role pre-selected when creating a new key. Tweak if the team
 *  decides a different role is the safer starting point. */
const DEFAULT_NEW_CLIENT_ROLES = ['integrations']

function ApiClientForm({ mode, roleOptions, onDone, onCreated }: ApiClientFormProps) {
  const isEdit = mode.kind === 'edit'
  const existing = isEdit ? mode.client : null
  const isStale = isEdit && existing !== null && existing.actsAsUserId === null

  const [name, setName] = useState(existing?.name ?? '')
  const [roleNames, setRoleNames] = useState<string[]>(
    existing?.roleNames && existing.roleNames.length > 0
      ? existing.roleNames
      : DEFAULT_NEW_CLIENT_ROLES,
  )
  const [formError, setFormError] = useState<string | null>(null)

  const createMutation = useCreateApiClient()
  const updateMutation = useUpdateApiClient()
  const isPending = createMutation.isPending || updateMutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (roleNames.length === 0) {
      setFormError('Pick at least one role — without one the key cannot do anything.')
      return
    }

    try {
      if (isEdit && existing) {
        const data: { name?: string; roleNames?: string[] } = {}
        if (name !== existing.name) data.name = name

        const existingSorted = [...existing.roleNames].sort().join(',')
        const nextSorted = [...roleNames].sort().join(',')
        if (existingSorted !== nextSorted) data.roleNames = roleNames

        if (Object.keys(data).length > 0) {
          await updateMutation.mutateAsync({ id: existing.id, data })
        }
        onDone()
      } else {
        const created = await createMutation.mutateAsync({ name, roleNames })
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
            ? 'Update the name and assigned roles for this API client. Roles control what the key can do.'
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

          {/* Roles */}
          <div className="space-y-1.5">
            <Label>Roles</Label>
            {isStale ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  This key was created before role-based access control was rolled out. Revoke it
                  and create a replacement to assign roles.
                </span>
              </div>
            ) : (
              <RoleCheckboxList
                options={roleOptions}
                selected={roleNames}
                onChange={setRoleNames}
                disabled={isPending}
                idPrefix="api-client-role"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Permissions are the union of every role assigned. The key acts as a service-account
              user with these roles when it authenticates.
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
            <Button
              type="submit"
              disabled={isPending || isStale}
              className="gap-2"
              title={
                isStale ? 'Stale key — revoke and create a new one to assign roles.' : undefined
              }
            >
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
// Tenant identity (shown at the top — handy for support + API calls)
// ---------------------------------------------------------------------------

function TenantInfoCard() {
  const session = getSession()
  const [copied, setCopied] = useState(false)

  // No session (e.g. test/SSR contexts) — nothing useful to show.
  if (!session) return null

  async function copyTenantId() {
    try {
      await navigator.clipboard.writeText(session!.tenantId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-muted-foreground" />
          <CardTitle>Tenant</CardTitle>
        </div>
        <CardDescription>
          Your tenant&rsquo;s identifier. Quote it when contacting support or use it in API calls.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-2">
          {session.tenantName && (
            <>
              <span className="text-muted-foreground">Name</span>
              <span>{session.tenantName}</span>
            </>
          )}

          <span className="text-muted-foreground">Tenant ID</span>
          <span className="flex items-center gap-2">
            <code className="font-mono break-all">{session.tenantId}</code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => void copyTenantId()}
              title="Copy tenant ID"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Usage instructions (shared)
// ---------------------------------------------------------------------------

function ApiUsageCard() {
  const apiUrl = getConfig().apiUrl.replace(/\/$/, '')
  const docsUrl = `${apiUrl}/docs`
  const openApiUrl = `${apiUrl}/openapi.json`
  const curlExample = `curl -H "Authorization: Bearer <your-key>" \\
  ${apiUrl}/api/v1/orders`

  const [copied, setCopied] = useState(false)

  async function copyCurl() {
    try {
      await navigator.clipboard.writeText(curlExample)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Terminal size={18} className="text-muted-foreground" />
          <CardTitle>How to use your API key</CardTitle>
        </div>
        <CardDescription>
          Authenticate with the <code className="font-mono">Authorization</code> header. Keys
          created here only work on the M2M endpoints below — the rest of{' '}
          <code className="font-mono">/api/v1</code> requires a user session.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4 sm:gap-y-2">
          <span className="text-muted-foreground">Base URL</span>
          <code className="font-mono break-all">{apiUrl}</code>

          <span className="text-muted-foreground">Header</span>
          <code className="font-mono break-all">Authorization: Bearer &lt;your-key&gt;</code>

          <span className="text-muted-foreground">Endpoints</span>
          <span className="font-mono text-xs">
            <code>POST /api/v1/events</code>, <code>GET /api/v1/events/:eventType</code>,{' '}
            <code>GET /api/v1/orders</code>, <code>POST /api/v1/orders</code>
          </span>
        </div>

        <div className="relative">
          <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 pr-12 text-xs font-mono">
            {curlExample}
          </pre>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1.5 h-7 w-7"
            onClick={() => void copyCurl()}
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink size={14} />
            Browse API docs (Swagger UI)
          </a>
          <a
            href={openApiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary hover:underline"
          >
            <ExternalLink size={14} />
            OpenAPI spec (JSON)
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Copyable code block (shared)
// ---------------------------------------------------------------------------

function CopyableBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 pr-12 text-xs font-mono">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-7 w-7"
        onClick={() => void copy()}
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Workflows SDK instructions
// ---------------------------------------------------------------------------

function WorkflowsSdkCard() {
  const apiUrl = getConfig().apiUrl.replace(/\/$/, '')
  const installCmd = 'pip install pegasus-workflows-sdk'
  const setupCmd = `pegasus-workflows setup --api-root ${apiUrl}`
  const quickStartCmd = [
    'pegasus-workflows init demo',
    'cd demo',
    'pegasus-workflows test demo',
    'pegasus-workflows package',
    'pegasus-workflows push',
  ].join('\n')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package size={18} className="text-muted-foreground" />
          <CardTitle>Workflows SDK</CardTitle>
        </div>
        <CardDescription>
          Workflows are Python programs you author locally with the Pegasus Workflows SDK, then
          package and upload with the <code className="font-mono">pegasus-workflows</code> CLI. They
          run server-side and can call the Pegasus API on your tenant&rsquo;s behalf. Manage
          uploaded workflows under{' '}
          <Link to="/settings/workflows" className="text-primary hover:underline">
            Settings → Workflows
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium">1. Install the CLI (Python 3.11+)</p>
          <CopyableBlock code={installCmd} />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">2. Run first-time setup</p>
          <CopyableBlock code={setupCmd} />
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">setup</code> prompts (hidden) for a{' '}
            <code className="font-mono">vnd_…</code> API key and stores it in a{' '}
            <code className="font-mono">~/.pegasus/credentials</code> profile (
            <code className="font-mono">0600</code>) — so later commands need no{' '}
            <code className="font-mono">--token</code>. It also registers the authoring MCP server
            in <code className="font-mono">.mcp.json</code> so your AI coding agent (Claude Code,
            Cursor, …) gets full workflow-authoring context. Your API key is written only to the
            credentials file, never to <code className="font-mono">.mcp.json</code>. It performs no
            network calls. Re-run it any time; add{' '}
            <code className="font-mono">--print-mcp-config</code> to just emit the MCP stanza, or{' '}
            <code className="font-mono">--skip-mcp</code> to only seed credentials.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">3. Scaffold, test, package, and push</p>
          <CopyableBlock code={quickStartCmd} />
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">test</code> runs the workflow against a local Dockerized
            Temporal; <code className="font-mono">package</code> zips each workflow declared in{' '}
            <code className="font-mono">pegasus-workflows.toml</code>;{' '}
            <code className="font-mono">push</code> uploads it to this tenant using the profile{' '}
            <code className="font-mono">setup</code> seeded.
          </p>
        </div>

        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <strong>Token:</strong> <code className="font-mono">setup</code> (and{' '}
          <code className="font-mono">push</code>) need a <code className="font-mono">vnd_…</code>{' '}
          API key whose service account holds the{' '}
          <code className="font-mono">workflow_developer</code> role. Create one above, then paste
          it when <code className="font-mono">setup</code> prompts. To skip the profile, commands
          still accept <code className="font-mono">--token</code> or the{' '}
          <code className="font-mono">PEGASUS_WORKFLOW_TOKEN</code> environment variable.
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ApiClient row
// ---------------------------------------------------------------------------

type ApiClientRowProps = {
  client: ApiClient
  roleOptions: RoleOption[]
  canEdit: boolean
  canRotate: boolean
  canRevoke: boolean
  canDelete: boolean
  onEdit: (client: ApiClient) => void
  onRevoke: (client: ApiClient) => void
  onRotate: (client: ApiClient) => void
  onDelete: (client: ApiClient) => void
}

function ApiClientRowItem({
  client,
  roleOptions,
  canEdit,
  canRotate,
  canRevoke,
  canDelete,
  onEdit,
  onRevoke,
  onRotate,
  onDelete,
}: ApiClientRowProps) {
  const isRevoked = client.revokedAt !== null
  const isStale = client.actsAsUserId === null
  const labelFor = (name: string) => roleOptions.find((o) => o.name === name)?.label ?? name

  return (
    <div
      className={`flex items-center gap-4 rounded-lg border bg-card px-4 py-3 ${isRevoked ? 'opacity-60' : ''}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Key size={18} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{client.name}</span>
            <Badge variant="outline" className="text-xs font-mono">
              {client.keyPrefix}****
            </Badge>
            {isRevoked && (
              <Badge variant="destructive" className="text-xs">
                Revoked
              </Badge>
            )}
            {isStale && !isRevoked && (
              <Badge variant="destructive" className="text-xs">
                Stale — revoke and recreate
              </Badge>
            )}
            {client.roleNames.length > 0 ? (
              client.roleNames.map((r) => (
                <Badge key={r} variant="secondary" className="text-xs">
                  {labelFor(r)}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground italic">No roles</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground flex gap-4">
            <span>Created: {new Date(client.createdAt).toLocaleDateString()}</span>
            {client.lastUsedAt && (
              <span>Last Used: {new Date(client.lastUsedAt).toLocaleDateString()}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Authenticate with <code className="font-mono">Authorization: Bearer …</code> — see usage
            instructions above.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isRevoked && (
          <>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => onEdit(client)}
              >
                <Pencil size={13} />
                Edit
              </Button>
            )}
            {canRotate && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-100"
                onClick={() => onRotate(client)}
              >
                <RefreshCw size={13} />
                Rotate
              </Button>
            )}
            {canRevoke && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onRevoke(client)}
              >
                <Ban size={13} />
                Revoke
              </Button>
            )}
          </>
        )}
        {/* Delete is offered for both active and revoked keys — permanently
            removing a key (and its service-account principal) is the way to
            clean up a revoked key you no longer need. */}
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(client)}
          >
            <Trash2 size={13} />
            Delete
          </Button>
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
// Delete confirmation
// ---------------------------------------------------------------------------

type DeleteConfirmProps = {
  client: ApiClient
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeleteConfirm({ client, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Delete API Client?</CardTitle>
        <CardDescription>
          This permanently deletes <strong>{client.name}</strong> and its underlying service-account
          user. Any systems using this key will stop working immediately, and unlike revoking, this
          cannot be undone. Prefer <em>Revoke</em> if you only want to disable the key.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending} className="gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}
          Delete permanently
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
  const testMutation = useTestMssqlConnection()

  const [isEditing, setIsEditing] = useState(false)
  const [connectionString, setConnectionString] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<MssqlTestResult | null>(null)

  function startEditing() {
    setConnectionString(mssqlSettings?.mssqlConnectionString ?? '')
    setError(null)
    setTestResult(null)
    setIsEditing(true)
  }

  async function handleRunDiagnostic() {
    setTestResult(null)
    try {
      const result = await testMutation.mutateAsync()
      setTestResult(result)
    } catch (err) {
      setTestResult({
        ok: false,
        code: 'EXECUTOR_ERROR',
        detail:
          err instanceof Error ? err.message : 'Could not run the diagnostic. Please try again.',
        elapsedMs: 0,
      })
    }
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
    setTestResult(null)
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
          <div className="space-y-3">
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
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => void handleRunDiagnostic()}
                      disabled={testMutation.isPending}
                    >
                      {testMutation.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Stethoscope size={13} />
                      )}
                      Run diagnostic
                    </Button>
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
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={startEditing}
                >
                  <Pencil size={13} />
                  Edit
                </Button>
              </div>
            </div>

            {testResult && (
              <div
                className={
                  testResult.ok
                    ? 'flex items-start gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400'
                    : 'flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive'
                }
                role="status"
              >
                {testResult.ok ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                )}
                <span>{testResult.detail}</span>
              </div>
            )}
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
// pegII API health section
//
// Mirrors the "Run diagnostic" affordance on the Legacy Database Connection
// card, but probes the pegII team's on-prem API over the WireGuard tunnel
// (POST /api/v1/settings/pegii/test → open GET /health). Health-check only;
// pegII config editing lives elsewhere.
// ---------------------------------------------------------------------------

function PegiiHealthSection() {
  const testMutation = useTestPegiiConnection()
  const [testResult, setTestResult] = useState<PegiiTestResult | null>(null)

  async function handleCheckHealth() {
    setTestResult(null)
    try {
      const result = await testMutation.mutateAsync()
      setTestResult(result)
    } catch (err) {
      setTestResult({
        ok: false,
        code: 'HTTP_ERROR',
        detail:
          err instanceof Error ? err.message : 'Could not run the health check. Please try again.',
        elapsedMs: 0,
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server size={18} className="text-muted-foreground" />
          <CardTitle>pegII API Connection</CardTitle>
        </div>
        <CardDescription>
          Check that the on-prem pegII API is reachable over the tunnel (GET /health).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Runs a live health probe against the pegII API server.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => void handleCheckHealth()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Stethoscope size={13} />
            )}
            Check health
          </Button>
        </div>

        {testResult && (
          <div
            className={
              testResult.ok
                ? 'flex items-start gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400'
                : 'flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive'
            }
            role="status"
          >
            {testResult.ok ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
            )}
            <span>{testResult.detail}</span>
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
  | { kind: 'delete'; client: ApiClient }

export function DeveloperSettingsPage() {
  const { data: clients, isLoading, isError } = useQuery(apiClientsQueryOptions)
  const { data: roleOptions } = useQuery(roleOptionsQueryOptions)
  const revokeMutation = useRevokeApiClient()
  const rotateMutation = useRotateApiClient()
  const deleteMutation = useDeleteApiClient()
  const perms = usePermissions()
  const canCreate = perms.has('api_client:create')
  const canRotate = perms.has('api_client:rotate')
  const canRevoke = perms.has('api_client:revoke')
  const canDelete = perms.has('api_client:delete')
  const safeRoleOptions = roleOptions ?? []

  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })
  const [newKey, setNewKey] = useState<ApiClientWithKey | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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

  async function handleDelete(client: ApiClient) {
    setActionError(null)
    try {
      await deleteMutation.mutateAsync(client.id)
      closePanel()
    } catch (err) {
      // Surface the 409 (runtime-owned key) or any other failure inline rather
      // than silently leaving the confirm panel open.
      setActionError(
        err instanceof Error ? err.message : 'Could not delete this key. Please try again.',
      )
    }
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Developer"
          breadcrumbs={[{ label: 'Settings' }, { label: 'Developer' }]}
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
          title="Developer"
          breadcrumbs={[{ label: 'Settings' }, { label: 'Developer' }]}
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
          title="Developer"
          breadcrumbs={[{ label: 'Settings' }, { label: 'Developer' }]}
          action={
            panel.kind !== 'add' && (
              <Button
                size="sm"
                className="gap-2"
                disabled={!canCreate}
                title={canCreate ? undefined : 'You do not have permission to create API clients.'}
                onClick={() => setPanel({ kind: 'add' })}
              >
                <Plus size={14} />
                Create API Client
              </Button>
            )
          }
        />

        <div className="space-y-3">
          <TenantInfoCard />

          <ApiUsageCard />

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
                    roleOptions={safeRoleOptions}
                    canEdit={canCreate}
                    canRotate={canRotate}
                    canRevoke={canRevoke}
                    canDelete={canDelete}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                    onDelete={() => setPanel({ kind: 'delete', client })}
                  />
                  <ApiClientForm
                    mode={{ kind: 'edit', client }}
                    roleOptions={safeRoleOptions}
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
                    roleOptions={safeRoleOptions}
                    canEdit={canCreate}
                    canRotate={canRotate}
                    canRevoke={canRevoke}
                    canDelete={canDelete}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                    onDelete={() => setPanel({ kind: 'delete', client })}
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
                    roleOptions={safeRoleOptions}
                    canEdit={canCreate}
                    canRotate={canRotate}
                    canRevoke={canRevoke}
                    canDelete={canDelete}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                    onDelete={() => setPanel({ kind: 'delete', client })}
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

            if (panel.kind === 'delete' && panel.client.id === client.id) {
              return (
                <div key={client.id} className="space-y-2">
                  <ApiClientRowItem
                    client={client}
                    roleOptions={safeRoleOptions}
                    canEdit={canCreate}
                    canRotate={canRotate}
                    canRevoke={canRevoke}
                    canDelete={canDelete}
                    onEdit={() => setPanel({ kind: 'edit', client })}
                    onRevoke={() => setPanel({ kind: 'revoke', client })}
                    onRotate={() => setPanel({ kind: 'rotate', client })}
                    onDelete={() => setPanel({ kind: 'delete', client })}
                  />
                  <DeleteConfirm
                    client={client}
                    onConfirm={() => void handleDelete(client)}
                    onCancel={() => {
                      setActionError(null)
                      closePanel()
                    }}
                    isPending={deleteMutation.isPending}
                  />
                  {actionError && (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertCircle size={14} className="shrink-0" />
                      {actionError}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <ApiClientRowItem
                key={client.id}
                client={client}
                roleOptions={safeRoleOptions}
                canEdit={canCreate}
                canRotate={canRotate}
                canRevoke={canRevoke}
                canDelete={canDelete}
                onEdit={(c) => setPanel({ kind: 'edit', client: c })}
                onRevoke={(c) => setPanel({ kind: 'revoke', client: c })}
                onRotate={(c) => setPanel({ kind: 'rotate', client: c })}
                onDelete={(c) => setPanel({ kind: 'delete', client: c })}
              />
            )
          })}

          {panel.kind === 'add' && (
            <ApiClientForm
              mode={{ kind: 'add' }}
              roleOptions={safeRoleOptions}
              onDone={closePanel}
              onCreated={(c) => {
                closePanel()
                setNewKey(c)
              }}
            />
          )}
        </div>

        <Separator className="my-6" />

        <WorkflowsSdkCard />

        <Separator className="my-6" />

        <MssqlSettingsSection />

        <Separator className="my-6" />

        <PegiiHealthSection />
      </div>

      {newKey && <KeyDisplayModal clientWithKey={newKey} onClose={() => setNewKey(null)} />}
    </>
  )
}
