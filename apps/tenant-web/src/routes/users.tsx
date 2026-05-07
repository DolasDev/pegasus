// ---------------------------------------------------------------------------
// User Management — /settings/users
//
// Lets tenant administrators manage their user roster: invite employees,
// update their roles, and deactivate access.
//
// Access is restricted to tenant_admin role (client-side guard + server-side
// RBAC enforcement on every API call).
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserPlus, UserX, ShieldAlert, Loader2, AlertCircle, Pencil, Check, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import {
  usersQueryOptions,
  useInviteUser,
  useUpdateUserRole,
  useUpdateUserLegacyWindowsUsername,
  useDeactivateUser,
  type TenantUser,
} from '@/api/queries/users'
import { getSession } from '@/auth/session'

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

type InviteFormProps = {
  onDone: () => void
}

function InviteForm({ onDone }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const [roleNames, setRoleNames] = useState<string[]>(['tenant_user'])
  const [formError, setFormError] = useState<string | null>(null)
  const inviteMutation = useInviteUser()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      await inviteMutation.mutateAsync({ email, roleNames })
      onDone()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite user</CardTitle>
        <CardDescription>
          The user will receive an email with a temporary password to set up their account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="employee@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <div className="flex gap-3">
              {(
                [
                  { value: 'tenant_user', label: 'User' },
                  { value: 'tenant_admin', label: 'Admin' },
                ] as const
              ).map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRoleNames([r.value])}
                  className={[
                    'flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                    roleNames[0] === r.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/50',
                  ].join(' ')}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Admins can manage users and SSO settings. Users have standard access.
            </p>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={14} className="shrink-0" />
              {formError}
            </div>
          )}

          <Separator />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onDone}
              disabled={inviteMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={inviteMutation.isPending} className="gap-2">
              {inviteMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Send invite
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Deactivate confirmation
// ---------------------------------------------------------------------------

type DeactivateConfirmProps = {
  user: TenantUser
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeactivateConfirm({ user, onConfirm, onCancel, isPending }: DeactivateConfirmProps) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Deactivate user?</CardTitle>
        <CardDescription>
          <strong>{user.email}</strong> will no longer be able to sign in. Their data will be
          retained. You can re-invite them later if needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending} className="gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}
          Deactivate
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Status and role badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: TenantUser['status'] }) {
  const map = {
    ACTIVE: { label: 'Active', variant: 'default' as const },
    PENDING: { label: 'Pending', variant: 'secondary' as const },
    DEACTIVATED: { label: 'Deactivated', variant: 'outline' as const },
  }
  const { label, variant } = map[status]
  return (
    <Badge variant={variant} className="text-xs">
      {label}
    </Badge>
  )
}

function RoleBadge({ roleNames }: { roleNames: TenantUser['roleNames'] }) {
  const isAdmin = roleNames.includes('tenant_admin')
  return (
    <Badge variant={isAdmin ? 'default' : 'secondary'} className="text-xs">
      {isAdmin ? 'Admin' : 'User'}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// User row
// ---------------------------------------------------------------------------

type LegacyWindowsUsernameEditorProps = {
  user: TenantUser
  onSave: (legacyWindowsUsername: string | null) => Promise<void>
}

function LegacyWindowsUsernameEditor({ user, onSave }: LegacyWindowsUsernameEditorProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(user.legacyWindowsUsername ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setValue(user.legacyWindowsUsername ?? '')
  }, [user.legacyWindowsUsername, editing])

  async function handleSave() {
    setError(null)
    const trimmed = value.trim()
    const next: string | null = trimmed === '' ? null : trimmed
    setSaving(true)
    try {
      await onSave(next)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
      >
        Windows user:{' '}
        <span className="font-mono">
          {user.legacyWindowsUsername ?? <span className="italic">unset</span>}
        </span>
        <Pencil size={11} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">Windows user:</span>
      <Input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleSave()
          if (e.key === 'Escape') setEditing(false)
        }}
        disabled={saving}
        autoFocus
        className="h-6 w-32 px-2 py-0 text-xs"
        placeholder="—"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        onClick={() => void handleSave()}
        disabled={saving}
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0"
        onClick={() => setEditing(false)}
        disabled={saving}
      >
        <X size={12} />
      </Button>
      {error && <span className="ml-1 text-xs text-destructive">{error}</span>}
    </div>
  )
}

type UserRowProps = {
  user: TenantUser
  currentUserEmail: string
  onDeactivate: (user: TenantUser) => void
  onToggleRole: (user: TenantUser) => void
  onSaveLegacyWindowsUsername: (
    user: TenantUser,
    legacyWindowsUsername: string | null,
  ) => Promise<void>
}

function UserRow({
  user,
  currentUserEmail,
  onDeactivate,
  onToggleRole,
  onSaveLegacyWindowsUsername,
}: UserRowProps) {
  const isSelf = user.email === currentUserEmail
  const isDeactivated = user.status === 'DEACTIVATED'

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={[
                'text-sm font-medium',
                isDeactivated ? 'text-muted-foreground line-through' : '',
              ].join(' ')}
            >
              {user.email}
            </span>
            <RoleBadge roleNames={user.roleNames} />
            <StatusBadge status={user.status} />
            {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Invited {new Date(user.invitedAt).toLocaleDateString()}
              {user.activatedAt &&
                ` · Active since ${new Date(user.activatedAt).toLocaleDateString()}`}
            </span>
            {!isDeactivated && (
              <LegacyWindowsUsernameEditor
                user={user}
                onSave={(v) => onSaveLegacyWindowsUsername(user, v)}
              />
            )}
          </div>
        </div>
      </div>
      {!isDeactivated && !isSelf && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => onToggleRole(user)}
          >
            <ShieldAlert size={13} />
            {user.roleNames.includes('tenant_admin') ? 'Make user' : 'Make admin'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-destructive hover:text-destructive"
            onClick={() => onDeactivate(user)}
          >
            <UserX size={13} />
            Deactivate
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UsersPage
// ---------------------------------------------------------------------------

type PanelState = { kind: 'none' } | { kind: 'invite' } | { kind: 'deactivate'; user: TenantUser }

export function UsersPage() {
  const session = getSession()
  const { data: usersData, isLoading, isError } = useQuery(usersQueryOptions)
  const users = usersData ?? []
  const deactivateMutation = useDeactivateUser()
  const roleMutation = useUpdateUserRole()
  const legacyWindowsUsernameMutation = useUpdateUserLegacyWindowsUsername()
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })

  // Client-side guard — page only accessible to tenant_admin.
  if (!session?.roleNames.includes('tenant_admin')) {
    return (
      <div>
        <PageHeader title="Users" breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]} />
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={16} />
          You do not have permission to manage users.
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Users" breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading users…
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="Users" breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]} />
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle size={16} />
          Failed to load users. Please refresh and try again.
        </div>
      </div>
    )
  }

  async function handleDeactivate(user: TenantUser) {
    try {
      await deactivateMutation.mutateAsync(user.id)
      setPanel({ kind: 'none' })
    } catch {
      // Error surfaces via deactivateMutation.error — keep panel open for retry.
    }
  }

  async function handleToggleRole(user: TenantUser) {
    const newRoleNames = user.roleNames.includes('tenant_admin')
      ? ['tenant_user']
      : ['tenant_admin']
    try {
      await roleMutation.mutateAsync({ id: user.id, input: { roleNames: newRoleNames } })
    } catch {
      // Error surfaces via roleMutation.error
    }
  }

  async function handleSaveLegacyWindowsUsername(
    user: TenantUser,
    legacyWindowsUsername: string | null,
  ) {
    await legacyWindowsUsernameMutation.mutateAsync({ id: user.id, legacyWindowsUsername })
  }

  return (
    <div>
      <PageHeader
        title="Users"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Users' }]}
        action={
          panel.kind !== 'invite' && (
            <Button size="sm" className="gap-2" onClick={() => setPanel({ kind: 'invite' })}>
              <UserPlus size={14} />
              Invite user
            </Button>
          )
        }
      />

      <div className="space-y-3">
        {users.length === 0 && panel.kind === 'none' && (
          <EmptyState
            title="No users yet"
            description="Invite your team members to give them access to Pegasus."
          />
        )}

        {users.map((user) => {
          if (panel.kind === 'deactivate' && panel.user.id === user.id) {
            return (
              <div key={user.id} className="space-y-2">
                <UserRow
                  user={user}
                  currentUserEmail={session?.email ?? ''}
                  onDeactivate={(u) => setPanel({ kind: 'deactivate', user: u })}
                  onToggleRole={(u) => void handleToggleRole(u)}
                  onSaveLegacyWindowsUsername={handleSaveLegacyWindowsUsername}
                />
                <DeactivateConfirm
                  user={user}
                  onConfirm={() => void handleDeactivate(user)}
                  onCancel={() => setPanel({ kind: 'none' })}
                  isPending={deactivateMutation.isPending}
                />
              </div>
            )
          }

          return (
            <UserRow
              key={user.id}
              user={user}
              currentUserEmail={session?.email ?? ''}
              onDeactivate={(u) => setPanel({ kind: 'deactivate', user: u })}
              onToggleRole={(u) => void handleToggleRole(u)}
              onSaveLegacyWindowsUsername={handleSaveLegacyWindowsUsername}
            />
          )
        })}

        {panel.kind === 'invite' && <InviteForm onDone={() => setPanel({ kind: 'none' })} />}
      </div>
    </div>
  )
}
