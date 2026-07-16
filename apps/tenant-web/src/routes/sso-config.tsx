// ---------------------------------------------------------------------------
// SSO Configuration — /settings/sso
//
// Lets tenant administrators manage their SSO identity providers. Adding a provider
// here CREATES it in the Cognito User Pool (POST /api/v1/sso/providers →
// CreateIdentityProvider); editing and deleting sync through to Cognito the same way.
// Nothing needs to exist in the pool beforehand.
//
// Scope:
//   - List configured providers (read from DB)
//   - Add a new provider (OIDC or SAML) — provisions it in Cognito
//   - Edit display name, metadataUrl, oidcClientId, client secret, or enable/disable
//   - Delete a provider — removes it from Cognito first
//
// The OIDC client secret is write-only: it is forwarded to Cognito and never stored
// by Pegasus or returned by the API, so it cannot be pre-filled on edit. Because the
// API holds no copy, changing an OIDC provider's discovery URL or client ID requires
// re-entering the secret — otherwise the Cognito sync would drop it and break login.
//
// Out of scope:
//   - Uploading SAML certificates
//   - Configuring the SAML email claim name (hardcoded to `email` server-side)
//
// Phase 5 note: This page should be restricted to tenant_admin role via RBAC. The
// perms.has('setting:update') gate below is UI-only — the API does not enforce it yet.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Loader2,
  AlertCircle,
  KeyRound,
  Copy,
  Check,
  Info,
} from 'lucide-react'
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
  useUpdateAuthSettings,
  type SsoProvider,
  type CreateSsoProviderInput,
  type UpdateSsoProviderInput,
} from '@/api/queries/sso'
import { usePermissions } from '@/auth/permissions'
import { getConfig } from '@/config'

// ---------------------------------------------------------------------------
// IdP setup hints — environment-specific values the admin must register at
// their external identity provider before the form can be completed.
// ---------------------------------------------------------------------------

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — ignore
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input value={value} readOnly className="h-8 font-mono bg-muted/50 text-xs" />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void copyToClipboard()}
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </Button>
      </div>
    </div>
  )
}

export function IdpSetupHints({ type }: { type: 'OIDC' | 'SAML' }) {
  const { cognito } = getConfig()

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Info size={14} className="shrink-0 text-muted-foreground" />
        Configure your identity provider first
      </div>
      {type === 'OIDC' ? (
        <>
          <CopyField
            label="Redirect / callback URI (allow at your IdP)"
            value={`${cognito.domain}/oauth2/idpresponse`}
          />
          <CopyField label="Authorize scopes" value="openid email profile" />
          <p className="text-xs text-muted-foreground">
            Create an OAuth/OIDC client at your identity provider using this redirect URI, then
            enter the issued client ID and secret below. Your IdP must release the{' '}
            <code>email</code> claim — it is mapped to the Cognito email attribute.
          </p>
        </>
      ) : (
        <>
          <CopyField label="ACS / Reply URL" value={`${cognito.domain}/saml2/idpresponse`} />
          <CopyField
            label="SP Entity ID / Audience URI"
            value={`urn:amazon:cognito:sp:${cognito.userPoolId}`}
          />
          <p className="text-xs text-muted-foreground">
            Register a SAML application at your identity provider with these values, then paste its
            metadata URL below. The assertion must include an <code>email</code> attribute.
          </p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------

type FormMode = { kind: 'add' } | { kind: 'edit'; provider: SsoProvider }

type ProviderFormProps = {
  mode: FormMode
  onDone: () => void
}

export function ProviderForm({ mode, onDone }: ProviderFormProps) {
  const isEdit = mode.kind === 'edit'
  const existing = isEdit ? mode.provider : null

  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<'OIDC' | 'SAML'>(existing?.type ?? 'OIDC')
  const [cognitoProviderName, setCognitoProviderName] = useState(
    existing?.cognitoProviderName ?? '',
  )
  const [metadataUrl, setMetadataUrl] = useState(existing?.metadataUrl ?? '')
  const [oidcClientId, setOidcClientId] = useState(existing?.oidcClientId ?? '')
  // Write-only: the API never returns the secret, so there is nothing to pre-fill.
  // Blank on edit means "leave the stored secret alone".
  const [oidcClientSecret, setOidcClientSecret] = useState('')
  const [isEnabled, setIsEnabled] = useState(existing?.isEnabled ?? true)
  const [formError, setFormError] = useState<string | null>(null)

  const isOidc = type === 'OIDC' || (isEdit && existing?.type === 'OIDC')

  // Cognito stores these; changing either forces a re-sync, which needs the secret
  // again because the API keeps no copy to re-send.
  const oidcConfigChanged =
    isEdit &&
    existing !== null &&
    (metadataUrl !== (existing.metadataUrl ?? '') || oidcClientId !== (existing.oidcClientId ?? ''))
  const secretRequired = isOidc && (!isEdit || oidcConfigChanged)

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
          ...(metadataUrl !== (existing.metadataUrl ?? '')
            ? { metadataUrl: metadataUrl || undefined }
            : {}),
          ...(oidcClientId !== (existing.oidcClientId ?? '')
            ? { oidcClientId: oidcClientId || undefined }
            : {}),
          // Only send when actually re-entered — an empty field must never clear it.
          ...(oidcClientSecret ? { oidcClientSecret } : {}),
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
          ...(type === 'OIDC' && oidcClientSecret ? { oidcClientSecret } : {}),
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
            ? 'Update the provider display name, metadata URL, client ID, or client secret. The Cognito provider name and protocol type cannot be changed — delete and recreate the provider to change them.'
            : 'Add an identity provider. It is created in your Cognito User Pool for you — nothing needs to exist there beforehand.'}
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

          {/* Values to register at the external IdP for this environment */}
          <IdpSetupHints type={type} />

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
                A name of your choosing — it is created in your Cognito User Pool and identifies
                this provider in the login URL. Must be unique across the pool. Only letters,
                digits, hyphens, and underscores. Immutable after creation.
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
          {isOidc && (
            <div className="space-y-1.5">
              <Label htmlFor="oidcClientId">
                OIDC client ID
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input
                id="oidcClientId"
                placeholder="e.g. 0oa1abc123..."
                value={oidcClientId}
                onChange={(e) => setOidcClientId(e.target.value)}
                required={!isEdit}
              />
              <p className="text-xs text-muted-foreground">
                The client ID issued by your IdP for the OAuth/OIDC client you created above.
              </p>
            </div>
          )}

          {/* OIDC client secret — write-only; never returned by the API */}
          {isOidc && (
            <div className="space-y-1.5">
              <Label htmlFor="oidcClientSecret">
                OIDC client secret
                {secretRequired && <span className="ml-1 text-destructive">*</span>}
              </Label>
              <Input
                id="oidcClientSecret"
                type="password"
                autoComplete="new-password"
                placeholder={isEdit ? 'Leave blank to keep the current secret' : ''}
                value={oidcClientSecret}
                onChange={(e) => setOidcClientSecret(e.target.value)}
                required={secretRequired}
              />
              <p className="text-xs text-muted-foreground">
                {secretRequired && isEdit
                  ? 'Changing the discovery URL or client ID re-registers this provider with Cognito, so the secret must be entered again — it is stored only in Cognito and cannot be read back.'
                  : isEdit
                    ? 'Leave blank to keep the current secret. Enter a new value to rotate it.'
                    : 'The client secret issued alongside the client ID (in Entra ID: App registration → Certificates & secrets). Sign-in fails without it.'}{' '}
                Sent straight to Cognito — never stored by Pegasus and never shown again.
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
  canMutate: boolean
  onEdit: (provider: SsoProvider) => void
  onDelete: (provider: SsoProvider) => void
}

function ProviderRow({ provider, canMutate, onEdit, onDelete }: ProviderRowProps) {
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
      {canMutate && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onEdit(provider)}
          >
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
      )}
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

// ---------------------------------------------------------------------------
// CognitoAuthToggle — standalone toggle for built-in password login
// ---------------------------------------------------------------------------

function CognitoAuthToggle({ initialValue }: { initialValue: boolean }) {
  const [enabled, setEnabled] = useState(initialValue)
  const updateMutation = useUpdateAuthSettings()

  async function handleToggle() {
    const newValue = !enabled
    setEnabled(newValue)
    try {
      await updateMutation.mutateAsync(newValue)
    } catch {
      // Revert on failure
      setEnabled(!newValue)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound size={16} className="text-muted-foreground" />
          Password sign-in
        </CardTitle>
        <CardDescription>
          When enabled, users can sign in with their Cognito email and password in addition to any
          configured SSO providers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => void handleToggle()}
            disabled={updateMutation.isPending}
            className={[
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              enabled ? 'bg-primary' : 'bg-muted',
              updateMutation.isPending ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform',
                enabled ? 'translate-x-5' : 'translate-x-1',
              ].join(' ')}
            />
          </button>
          <span className="text-sm text-muted-foreground">
            {enabled ? 'Enabled — password login is available' : 'Disabled — SSO providers only'}
          </span>
          {updateMutation.isPending && (
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function SsoConfigPage() {
  const { data, isLoading, isError } = useQuery(ssoProvidersQueryOptions)
  const providers = data?.providers ?? []
  const cognitoAuthEnabled = data?.cognitoAuthEnabled ?? true
  const deleteMutation = useDeleteSsoProvider()
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })
  const perms = usePermissions()
  const canMutateSettings = perms.has('setting:update')

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
        <PageHeader
          title="SSO Providers"
          breadcrumbs={[{ label: 'Settings' }, { label: 'SSO Providers' }]}
        />
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
        <PageHeader
          title="SSO Providers"
          breadcrumbs={[{ label: 'Settings' }, { label: 'SSO Providers' }]}
        />
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
              disabled={!canMutateSettings}
              title={
                canMutateSettings ? undefined : 'You do not have permission to modify SSO settings.'
              }
              onClick={() => setPanel({ kind: 'add' })}
            >
              <Plus size={14} />
              Add provider
            </Button>
          )
        }
      />

      {/* Built-in password auth toggle */}
      <div className="mb-6">
        <CognitoAuthToggle initialValue={cognitoAuthEnabled} />
      </div>

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
                  canMutate={canMutateSettings}
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
                  canMutate={canMutateSettings}
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
              canMutate={canMutateSettings}
              onEdit={(p) => setPanel({ kind: 'edit', provider: p })}
              onDelete={(p) => setPanel({ kind: 'delete', provider: p })}
            />
          )
        })}

        {/* Add provider form — shown below the list */}
        {panel.kind === 'add' && <ProviderForm mode={{ kind: 'add' }} onDone={closePanel} />}
      </div>
    </div>
  )
}
