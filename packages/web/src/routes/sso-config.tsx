// ---------------------------------------------------------------------------
// SSO Configuration — /settings/sso
//
// Lets tenant administrators manage their SSO identity providers. Each provider
// maps to a Cognito identity provider registered in the User Pool.
//
// Phase 3 scope:
//   - List configured providers (read from DB)
//   - Add a new provider (OIDC or SAML)
//   - Edit display name, metadataUrl, oidcClientId, or enable/disable
//   - Delete a provider
//
// Out of scope (Phase 4+):
//   - Provisioning the IdP in Cognito automatically
//   - Uploading SAML certificates
//   - Rotating OIDC client secrets (stored in Secrets Manager, not here)
//
// Phase 5 note: This page should be restricted to tenant_admin role via RBAC.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ShieldCheck, Loader2, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  ssoProvidersQueryOptions,
  useCreateSsoProvider,
  useUpdateSsoProvider,
  useDeleteSsoProvider,
  type SsoProvider,
  type CreateSsoProviderInput,
  type UpdateSsoProviderInput,
} from '@/api/queries/sso'

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

type FormMode =
  | { kind: 'add' }
  | { kind: 'edit'; provider: SsoProvider }

type ProviderFormProps = {
  mode: FormMode
  onDone: () => void
}

function ProviderForm({ mode, onDone }: ProviderFormProps) {
  const isEdit = mode.kind === 'edit'
  const existing = isEdit ? mode.provider : null

  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<'OIDC' | 'SAML'>(existing?.type ?? 'OIDC')
  const [cognitoProviderName, setCognitoProviderName] = useState(
    existing?.cognitoProviderName ?? '',
  )
  const [metadataUrl, setMetadataUrl] = useState(existing?.metadataUrl ?? '')
  const [oidcClientId, setOidcClientId] = useState(existing?.oidcClientId ?? '')
  const [isEnabled, setIsEnabled] = useState(existing?.isEnabled ?? true)
  const [formError, setFormError] = useState<string | null>(null)

  const createMutation = useCreateSsoProvider()
  const updateMutation = useUpdateSsoProvider()
  const isPending = createMutation.isPending || updateMutation.isPending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    try {
      if (isEdit && existing) {
        const input: UpdateSsoProviderInput = {
          ...(name !== existing.name ? { name } : {}),
          ...(metadataUrl !== (existing.metadataUrl ?? '') ? { metadataUrl: metadataUrl || undefined } : {}),
          ...(oidcClientId !== (existing.oidcClientId ?? '') ? { oidcClientId: oidcClientId || undefined } : {}),
          ...(isEnabled !== existing.isEnabled ? { isEnabled } : {}),
        }
        await updateMutation.mutateAsync({ id: existing.id, input })
      } else {
        const input: CreateSsoProviderInput = {
          name,
          type,
          cognitoProviderName,
          ...(metadataUrl ? { metadataUrl } : {}),
          ...(type === 'OIDC' && oidcClientId ? { oidcClientId } : {}),
          isEnabled,
        }
        await createMutation.mutateAsync(input)
      }
      onDone()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setFormError(message)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? 'Edit provider' : 'Add SSO provider'}</CardTitle>
        <CardDescription>
          {isEdit
            ? 'Update the provider display name, metadata URL, or client ID. The Cognito provider name and protocol type cannot be changed — delete and recreate the provider to change them.'
            : 'Register an identity provider that is already configured in your Cognito User Pool.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void handleSubmit(e)
          }}
          className="space-y-5"
        >
          {/* Display name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              placeholder="e.g. Acme Okta"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              Shown in the login page provider picker.
            </p>
          </div>

          {/* Protocol type — immutable after creation */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Protocol type</Label>
              <div className="flex gap-3">
                {(['OIDC', 'SAML'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={[
                      'flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                      type === t
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent/50',
                    ].join(' ')}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cognito provider name — immutable after creation */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="cognitoProviderName">Cognito provider name</Label>
              <Input
                id="cognitoProviderName"
                placeholder="e.g. acme-okta"
                value={cognitoProviderName}
                onChange={(e) => setCognitoProviderName(e.target.value)}
                required
                maxLength={100}
                pattern="[a-zA-Z0-9_\-]+"
              />
              <p className="text-xs text-muted-foreground">
                Must exactly match the identity provider name registered in your Cognito User Pool.
                Only letters, digits, hyphens, and underscores. Immutable after creation.
              </p>
            </div>
          )}

          {/* Metadata URL */}
          <div className="space-y-1.5">
            <Label htmlFor="metadataUrl">
              {type === 'SAML' ? 'SAML metadata URL' : 'OIDC discovery URL'}
              {type === 'SAML' && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <Input
              id="metadataUrl"
              type="url"
              placeholder={
                type === 'SAML'
                  ? 'https://idp.example.com/metadata'
                  : 'https://accounts.google.com/.well-known/openid-configuration'
              }
              value={metadataUrl}
              onChange={(e) => setMetadataUrl(e.target.value)}
              required={type === 'SAML'}
            />
          </div>

          {/* OIDC client ID */}
          {(type === 'OIDC' || (isEdit && existing?.type === 'OIDC')) && (
            <div className="space-y-1.5">
              <Label htmlFor="oidcClientId">OIDC client ID</Label>
              <Input
                id="oidcClientId"
                placeholder="e.g. 0oa1abc123..."
                value={oidcClientId}
                onChange={(e) => setOidcClientId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The client ID issued by your IdP. The client secret is stored in Secrets Manager —
                it is not managed here.
              </p>
            </div>
          )}

          {/* Enable / disable */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={isEnabled}
              onClick={() => setIsEnabled(!isEnabled)}
              className={[
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                isEnabled ? 'bg-primary' : 'bg-muted',
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform',
                  isEnabled ? 'translate-x-5' : 'translate-x-1',
                ].join(' ')}
              />
            </button>
            <Label
              onClick={() => setIsEnabled(!isEnabled)}
              className="cursor-pointer select-none text-sm"
            >
              {isEnabled ? 'Enabled — shown on login page' : 'Disabled — hidden from login page'}
            </Label>
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
              {isEdit ? 'Save changes' : 'Add provider'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Provider row
// ---------------------------------------------------------------------------

type ProviderRowProps = {
  provider: SsoProvider
  onEdit: (provider: SsoProvider) => void
  onDelete: (provider: SsoProvider) => void
}

function ProviderRow({ provider, onEdit, onDelete }: ProviderRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ShieldCheck size={18} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{provider.name}</span>
            <Badge variant={provider.type === 'OIDC' ? 'default' : 'secondary'} className="text-xs">
              {provider.type}
            </Badge>
            {!provider.isEnabled && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                Disabled
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Cognito name: <code className="font-mono">{provider.cognitoProviderName}</code>
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => onEdit(provider)}>
          <Pencil size={13} />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-destructive hover:text-destructive"
          onClick={() => onDelete(provider)}
        >
          <Trash2 size={13} />
          Delete
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

type DeleteConfirmProps = {
  provider: SsoProvider
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeleteConfirm({ provider, onConfirm, onCancel, isPending }: DeleteConfirmProps) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Delete provider?</CardTitle>
        <CardDescription>
          This will remove <strong>{provider.name}</strong> (
          <code className="font-mono text-xs">{provider.cognitoProviderName}</code>) from Pegasus.
          Users who sign in via this provider will no longer be able to log in until a replacement
          is configured. You may also need to remove the corresponding identity provider from your
          Cognito User Pool.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending} className="gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}
          Delete provider
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SsoConfigPage
// ---------------------------------------------------------------------------

type PanelState =
  | { kind: 'none' }
  | { kind: 'add' }
  | { kind: 'edit'; provider: SsoProvider }
  | { kind: 'delete'; provider: SsoProvider }

export function SsoConfigPage() {
  const { data: providers = [], isLoading, isError } = useQuery(ssoProvidersQueryOptions)
  const deleteMutation = useDeleteSsoProvider()
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })

  function closePanel() {
    setPanel({ kind: 'none' })
  }

  async function handleDelete(provider: SsoProvider) {
    try {
      await deleteMutation.mutateAsync(provider.id)
      closePanel()
    } catch {
      // Error is available via deleteMutation.error — keep the panel open so
      // the user can retry or cancel.
    }
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader title="SSO Providers" breadcrumbs={[{ label: 'Settings' }, { label: 'SSO Providers' }]} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading providers…
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="SSO Providers" breadcrumbs={[{ label: 'Settings' }, { label: 'SSO Providers' }]} />
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={16} />
          Failed to load SSO providers. Please refresh and try again.
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="SSO Providers"
        breadcrumbs={[{ label: 'Settings' }, { label: 'SSO Providers' }]}
        action={
          panel.kind !== 'add' && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setPanel({ kind: 'add' })}
            >
              <Plus size={14} />
              Add provider
            </Button>
          )
        }
      />

      <div className="space-y-3">
        {/* Provider list */}
        {providers.length === 0 && panel.kind === 'none' && (
          <EmptyState
            title="No SSO providers configured"
            description="Add an identity provider to enable SSO login for your organisation. The provider must be registered in your Cognito User Pool first."
          />
        )}

        {providers.map((provider) => {
          // If this provider is being edited/deleted, show the panel inline.
          if (panel.kind === 'edit' && panel.provider.id === provider.id) {
            return (
              <div key={provider.id} className="space-y-2">
                <ProviderRow
                  provider={provider}
                  onEdit={() => setPanel({ kind: 'edit', provider })}
                  onDelete={() => setPanel({ kind: 'delete', provider })}
                />
                <ProviderForm mode={{ kind: 'edit', provider }} onDone={closePanel} />
              </div>
            )
          }

          if (panel.kind === 'delete' && panel.provider.id === provider.id) {
            return (
              <div key={provider.id} className="space-y-2">
                <ProviderRow
                  provider={provider}
                  onEdit={() => setPanel({ kind: 'edit', provider })}
                  onDelete={() => setPanel({ kind: 'delete', provider })}
                />
                <DeleteConfirm
                  provider={provider}
                  onConfirm={() => void handleDelete(provider)}
                  onCancel={closePanel}
                  isPending={deleteMutation.isPending}
                />
              </div>
            )
          }

          return (
            <ProviderRow
              key={provider.id}
              provider={provider}
              onEdit={(p) => setPanel({ kind: 'edit', provider: p })}
              onDelete={(p) => setPanel({ kind: 'delete', provider: p })}
            />
          )
        })}

        {/* Add provider form — shown below the list */}
        {panel.kind === 'add' && (
          <ProviderForm mode={{ kind: 'add' }} onDone={closePanel} />
        )}
      </div>
    </div>
  )
}
