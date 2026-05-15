// ---------------------------------------------------------------------------
// User Management — /settings/users
//
// Lets tenant administrators manage their user roster: invite employees,
// update their roles, and deactivate access.
//
// Access is restricted to tenant_admin role (client-side guard + server-side
// RBAC enforcement on every API call).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserPlus, UserX, ShieldCheck, Loader2, AlertCircle, Pencil, Check, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'
import { RoleCheckboxList } from '@/components/RoleCheckboxList'
import {
  usersQueryOptions,
  roleOptionsQueryOptions,
  useInviteUser,
  useUpdateUserRole,
  useUpdateUserLegacyWindowsUsername,
  useDeactivateUser,
  type TenantUser,
  type RoleOption,
} from '@/api/queries/users'
import { getSession } from '@/auth/session'
import { usePermissions } from '@/auth/permissions'

// Same copy as the server-side DELETE last-admin guard so the experience is
// consistent whether the rule trips client- or server-side.
const LAST_ADMIN_MESSAGE =
  'Cannot remove the last administrator. Promote another user to admin first.'

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

type InviteFormProps = {
  onDone: () => void
  roleOptions: RoleOption[]
}

function InviteForm({ onDone, roleOptions }: InviteFormProps) {
  const [email, setEmail] = useState('')
  const [roleNames, setRoleNames] = useState<string[]>(['viewer'])
  const [formError, setFormError] = useState<string | null>(null)
  const inviteMutation = useInviteUser()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (roleNames.length === 0) {
      setFormError('Pick at least one role.')
      return
    }
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
            <Label>Roles</Label>
            <RoleCheckboxList
              options={roleOptions}
              selected={roleNames}
              onChange={setRoleNames}
              disabled={inviteMutation.isPending}
              idPrefix="invite-role"
            />
            <p className="text-xs text-muted-foreground">
              Pick one or more roles. Permissions are the union of every role assigned.
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
// Manage roles panel
// ---------------------------------------------------------------------------

type ManageRolesPanelProps = {
  user: TenantUser
  roleOptions: RoleOption[]
  onSave: (roleNames: string[]) => Promise<void>
  onCancel: () => void
  isPending: boolean
  /** True if `user` is the only active tenant_admin — used for the
   *  client-side last-admin guard. */
  isLastActiveAdmin: boolean
}

function ManageRolesPanel({
  user,
  roleOptions,
  onSave,
  onCancel,
  isPending,
  isLastActiveAdmin,
}: ManageRolesPanelProps) {
  const [selected, setSelected] = useState<string[]>(user.roleNames)
  const [error, setError] = useState<string | null>(null)

  const wouldRemoveLastAdmin = isLastActiveAdmin && !selected.includes('tenant_admin')

  async function handleSubmit() {
    setError(null)
    if (selected.length === 0) {
      setError('Pick at least one role.')
      return
    }
    if (wouldRemoveLastAdmin) {
      setError(LAST_ADMIN_MESSAGE)
      return
    }
    try {
      await onSave(selected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage roles</CardTitle>
        <CardDescription>
          Update the roles assigned to <strong>{user.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RoleCheckboxList
          options={roleOptions}
          selected={selected}
          onChange={setSelected}
          disabled={isPending}
          idPrefix={`manage-role-${user.id}`}
        />

        {(error ?? (wouldRemoveLastAdmin ? LAST_ADMIN_MESSAGE : null)) && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle size={14} className="shrink-0" />
            {error ?? LAST_ADMIN_MESSAGE}
          </div>
        )}

        <Separator />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending || wouldRemoveLastAdmin || selected.length === 0}
            className="gap-2"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Save roles
          </Button>
        </div>
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

function RoleBadge({
  roleNames,
  roleOptions,
}: {
  roleNames: TenantUser['roleNames']
  roleOptions: RoleOption[]
}) {
  if (roleNames.length === 0) {
    return (
      <Badge variant="outline" className="text-xs">
        No roles
      </Badge>
    )
  }

  // Render up to 3 chips. Sort tenant_admin first so the most-privileged
  // role is always visible even when truncated.
  const labelFor = (name: string) => roleOptions.find((o) => o.name === name)?.label ?? name
  const sorted = [...roleNames].sort((a, b) => {
    if (a === 'tenant_admin') return -1
    if (b === 'tenant_admin') return 1
    return a.localeCompare(b)
  })
  const visible = sorted.slice(0, 3)
  const overflow = sorted.length - visible.length

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {visible.map((name) => (
        <Badge
          key={name}
          variant={name === 'tenant_admin' ? 'default' : 'secondary'}
          className="text-xs"
        >
          {labelFor(name)}
        </Badge>
      ))}
      {overflow > 0 && (
        <Badge
          variant="outline"
          className="text-xs"
          title={sorted.slice(3).map(labelFor).join(', ')}
        >
          +{overflow}
        </Badge>
      )}
    </span>
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
  roleOptions: RoleOption[]
  canManageRoles: boolean
  canDeactivate: boolean
  onDeactivate: (user: TenantUser) => void
  onManageRoles: (user: TenantUser) => void
  onSaveLegacyWindowsUsername: (
    user: TenantUser,
    legacyWindowsUsername: string | null,
  ) => Promise<void>
}

function UserRow({
  user,
  currentUserEmail,
  roleOptions,
  canManageRoles,
  canDeactivate,
  onDeactivate,
  onManageRoles,
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
            <RoleBadge roleNames={user.roleNames} roleOptions={roleOptions} />
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
      {!isDeactivated && (canManageRoles || (!isSelf && canDeactivate)) && (
        <div className="flex shrink-0 items-center gap-1">
          {canManageRoles && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => onManageRoles(user)}
            >
              <ShieldCheck size={13} />
              Manage roles
            </Button>
          )}
          {!isSelf && canDeactivate && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => onDeactivate(user)}
            >
              <UserX size={13} />
              Deactivate
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UsersPage
// ---------------------------------------------------------------------------

type PanelState =
  | { kind: 'none' }
  | { kind: 'invite' }
  | { kind: 'deactivate'; user: TenantUser }
  | { kind: 'manage'; user: TenantUser }

export function UsersPage() {
  const session = getSession()
  const perms = usePermissions()
  const canList = perms.has('user:list')
  const {
    data: usersData,
    isLoading,
    isError,
  } = useQuery({
    ...usersQueryOptions,
    enabled: canList,
  })
  const { data: roleOptions } = useQuery({
    ...roleOptionsQueryOptions,
    enabled: canList,
  })
  const users = usersData ?? []
  const deactivateMutation = useDeactivateUser()
  const roleMutation = useUpdateUserRole()
  const legacyWindowsUsernameMutation = useUpdateUserLegacyWindowsUsername()
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })

  // Count of currently-active tenant_admins. Used by ManageRolesPanel to
  // refuse client-side when the admin tries to remove tenant_admin from the
  // last remaining admin (mirrors the server-side guard on DELETE).
  const activeAdminCount = useMemo(
    () => users.filter((u) => u.status === 'ACTIVE' && u.roleNames.includes('tenant_admin')).length,
    [users],
  )

  // Client-side guard — page only accessible to principals with `user:list`.
  // Wait for the permission query to resolve before deciding (prevents a
  // permission-denied flash on first paint).
  if (!perms.isLoading && !canList) {
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

  if (perms.isLoading || isLoading) {
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

  async function handleSaveRoles(user: TenantUser, roleNames: string[]) {
    await roleMutation.mutateAsync({ id: user.id, input: { roleNames } })
    setPanel({ kind: 'none' })
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
            <Button
              size="sm"
              className="gap-2"
              disabled={!perms.has('user:invite')}
              title={
                perms.has('user:invite') ? undefined : 'You do not have permission to invite users.'
              }
              onClick={() => setPanel({ kind: 'invite' })}
            >
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
          const row = (
            <UserRow
              user={user}
              currentUserEmail={session?.email ?? ''}
              roleOptions={roleOptions ?? []}
              canManageRoles={perms.has('user:update')}
              canDeactivate={perms.has('user:deactivate')}
              onDeactivate={(u) => setPanel({ kind: 'deactivate', user: u })}
              onManageRoles={(u) => setPanel({ kind: 'manage', user: u })}
              onSaveLegacyWindowsUsername={handleSaveLegacyWindowsUsername}
            />
          )

          if (panel.kind === 'deactivate' && panel.user.id === user.id) {
            return (
              <div key={user.id} className="space-y-2">
                {row}
                <DeactivateConfirm
                  user={user}
                  onConfirm={() => void handleDeactivate(user)}
                  onCancel={() => setPanel({ kind: 'none' })}
                  isPending={deactivateMutation.isPending}
                />
              </div>
            )
          }

          if (panel.kind === 'manage' && panel.user.id === user.id) {
            const isLastActiveAdmin =
              user.status === 'ACTIVE' &&
              user.roleNames.includes('tenant_admin') &&
              activeAdminCount <= 1
            return (
              <div key={user.id} className="space-y-2">
                {row}
                <ManageRolesPanel
                  user={user}
                  roleOptions={roleOptions ?? []}
                  isLastActiveAdmin={isLastActiveAdmin}
                  onSave={(roleNames) => handleSaveRoles(user, roleNames)}
                  onCancel={() => setPanel({ kind: 'none' })}
                  isPending={roleMutation.isPending}
                />
              </div>
            )
          }

          return <div key={user.id}>{row}</div>
        })}

        {panel.kind === 'invite' && (
          <InviteForm onDone={() => setPanel({ kind: 'none' })} roleOptions={roleOptions ?? []} />
        )}
      </div>
    </div>
  )
}
