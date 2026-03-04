// ---------------------------------------------------------------------------
// User Management — /settings/users
//
// Lets tenant administrators manage their user roster: invite employees,
// update their roles, and deactivate access.
//
// Access is restricted to tenant_admin role (client-side guard + server-side
// RBAC enforcement on every API call).
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserPlus, UserX, ShieldAlert, Loader2, AlertCircle } from 'lucide-react'
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
  const [role, setRole] = useState<'ADMIN' | 'USER'>('USER')
  const [formError, setFormError] = useState<string | null>(null)
  const inviteMutation = useInviteUser()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      await inviteMutation.mutateAsync({ email, role })
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
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <div className="flex gap-3">
              {(['USER', 'ADMIN'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={[
                    'flex-1 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                    role === r
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent/50',
                  ].join(' ')}
                >
                  {r === 'ADMIN' ? 'Admin' : 'User'}
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
            <Button type="button" variant="outline" onClick={onDone} disabled={inviteMutation.isPending}>
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

function RoleBadge({ role }: { role: TenantUser['role'] }) {
  return (
    <Badge variant={role === 'ADMIN' ? 'default' : 'secondary'} className="text-xs">
      {role === 'ADMIN' ? 'Admin' : 'User'}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// User row
// ---------------------------------------------------------------------------

type UserRowProps = {
  user: TenantUser
  currentUserEmail: string
  onDeactivate: (user: TenantUser) => void
  onToggleRole: (user: TenantUser) => void
}

function UserRow({ user, currentUserEmail, onDeactivate, onToggleRole }: UserRowProps) {
  const isSelf = user.email === currentUserEmail
  const isDeactivated = user.status === 'DEACTIVATED'

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={['text-sm font-medium', isDeactivated ? 'text-muted-foreground line-through' : ''].join(' ')}>
              {user.email}
            </span>
            <RoleBadge role={user.role} />
            <StatusBadge status={user.status} />
            {isSelf && (
              <span className="text-xs text-muted-foreground">(you)</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Invited {new Date(user.invitedAt).toLocaleDateString()}
            {user.activatedAt && ` · Active since ${new Date(user.activatedAt).toLocaleDateString()}`}
          </p>
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
            {user.role === 'ADMIN' ? 'Make user' : 'Make admin'}
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

type PanelState =
  | { kind: 'none' }
  | { kind: 'invite' }
  | { kind: 'deactivate'; user: TenantUser }

export function UsersPage() {
  const session = getSession()
  const { data: usersData, isLoading, isError } = useQuery(usersQueryOptions)
  const users = usersData ?? []
  const deactivateMutation = useDeactivateUser()
  const roleMutation = useUpdateUserRole()
  const [panel, setPanel] = useState<PanelState>({ kind: 'none' })

  // Client-side guard — page only accessible to tenant_admin.
  if (session?.role !== 'tenant_admin') {
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
    const newRole = user.role === 'ADMIN' ? 'USER' : 'ADMIN'
    try {
      await roleMutation.mutateAsync({ id: user.id, input: { role: newRole } })
    } catch {
      // Error surfaces via roleMutation.error
    }
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
          if (panel.kind === 'deactivate' && panel.user.id === user.id) {
            return (
              <div key={user.id} className="space-y-2">
                <UserRow
                  user={user}
                  currentUserEmail={session?.email ?? ''}
                  onDeactivate={(u) => setPanel({ kind: 'deactivate', user: u })}
                  onToggleRole={(u) => void handleToggleRole(u)}
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
            />
          )
        })}

        {panel.kind === 'invite' && (
          <InviteForm onDone={() => setPanel({ kind: 'none' })} />
        )}
      </div>
    </div>
  )
}
