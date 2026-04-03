import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listTenantUsers,
  inviteTenantUser,
  updateTenantUserRole,
  deactivateTenantUser,
} from '@/api/tenant-users'
import type { TenantUser, TenantUserRole } from '@/api/tenant-users'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function RoleBadge({ role }: { role: TenantUser['role'] }) {
  const cls = role === 'ADMIN' ? 'bg-blue-100 text-blue-800' : 'bg-neutral-100 text-neutral-700'
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {role === 'ADMIN' ? 'Admin' : 'User'}
    </span>
  )
}

function StatusBadge({ status }: { status: TenantUser['status'] }) {
  const styles = {
    PENDING: 'bg-amber-100 text-amber-800',
    ACTIVE: 'bg-green-100 text-green-800',
    DEACTIVATED: 'bg-neutral-100 text-neutral-500',
  } as const
  const labels = { PENDING: 'Pending', ACTIVE: 'Active', DEACTIVATED: 'Deactivated' } as const
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

function InviteForm({
  tenantId,
  onSuccess,
  onCancel,
}: {
  tenantId: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TenantUserRole>('USER')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => inviteTenantUser(tenantId, { email, role }),
    onSuccess: () => {
      onSuccess()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <h3 className="text-sm font-medium text-foreground">Invite user</h3>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Email</label>
          <input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={mutation.isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TenantUserRole)}
            disabled={mutation.isPending}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !email.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? 'Inviting…' : 'Invite'}
        </button>
        <button
          onClick={onCancel}
          disabled={mutation.isPending}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// User row
// ---------------------------------------------------------------------------

function UserRow({
  user,
  tenantId,
  onMutated,
}: {
  user: TenantUser
  tenantId: string
  onMutated: () => void
}) {
  const [rowError, setRowError] = useState<string | null>(null)

  const roleMutation = useMutation({
    mutationFn: (role: TenantUserRole) => updateTenantUserRole(tenantId, user.id, role),
    onSuccess: () => {
      setRowError(null)
      onMutated()
    },
    onError: (err) => {
      setRowError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateTenantUser(tenantId, user.id),
    onSuccess: () => {
      setRowError(null)
      onMutated()
    },
    onError: (err) => {
      setRowError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const isPending = roleMutation.isPending || deactivateMutation.isPending

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="py-3 pr-4 text-sm text-foreground">{user.email}</td>
        <td className="py-3 pr-4">
          <RoleBadge role={user.role} />
        </td>
        <td className="py-3 pr-4">
          <StatusBadge status={user.status} />
        </td>
        <td className="py-3 pr-4 text-sm text-muted-foreground">{formatDate(user.invitedAt)}</td>
        <td className="py-3">
          <div className="flex items-center gap-2">
            {user.role === 'USER' ? (
              <button
                onClick={() => roleMutation.mutate('ADMIN')}
                disabled={isPending}
                className="text-xs text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Make admin
              </button>
            ) : (
              <button
                onClick={() => roleMutation.mutate('USER')}
                disabled={isPending}
                className="text-xs text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Make user
              </button>
            )}
            <button
              onClick={() => deactivateMutation.mutate()}
              disabled={user.status === 'DEACTIVATED' || isPending}
              className="text-xs text-destructive hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Deactivate
            </button>
          </div>
        </td>
      </tr>
      {rowError && (
        <tr>
          <td colSpan={5} className="pb-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {rowError}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function TenantUsersSection({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)

  const { data, isPending, isError } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: () => listTenantUsers(tenantId),
  })

  function refetch() {
    void queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] })
  }

  if (isPending) {
    return <div className="py-4 text-sm text-muted-foreground">Loading…</div>
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Failed to load users.
      </div>
    )
  }

  const users = data.data

  return (
    <div className="space-y-4">
      {showInvite ? (
        <InviteForm
          tenantId={tenantId}
          onSuccess={() => {
            setShowInvite(false)
            refetch()
          }}
          onCancel={() => setShowInvite(false)}
        />
      ) : (
        <button
          onClick={() => setShowInvite(true)}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          Invite user
        </button>
      )}

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="py-2 pr-4 text-left text-xs font-medium text-muted-foreground">
                  Email
                </th>
                <th className="py-2 pr-4 text-left text-xs font-medium text-muted-foreground">
                  Role
                </th>
                <th className="py-2 pr-4 text-left text-xs font-medium text-muted-foreground">
                  Status
                </th>
                <th className="py-2 pr-4 text-left text-xs font-medium text-muted-foreground">
                  Invited
                </th>
                <th className="py-2 text-left text-xs font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} tenantId={tenantId} onMutated={refetch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
