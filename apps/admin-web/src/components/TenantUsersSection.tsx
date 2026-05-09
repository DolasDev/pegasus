import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listTenantUsers,
  listTenantUserRoleOptions,
  inviteTenantUser,
  updateTenantUserRole,
  deactivateTenantUser,
  reactivateTenantUser,
} from '@/api/tenant-users'
import type { RoleOption, TenantUser } from '@/api/tenant-users'
import { ApiError } from '@/api/client'

// Same copy as the server-side last-admin guard so the experience matches
// regardless of which side trips first.
const LAST_ADMIN_MESSAGE =
  'Cannot remove the last administrator. Promote another user to admin first.'

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

function RoleBadges({
  roleNames,
  roleOptions,
}: {
  roleNames: TenantUser['roleNames']
  roleOptions: RoleOption[]
}) {
  if (roleNames.length === 0) {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-neutral-100 text-neutral-500">
        No roles
      </span>
    )
  }

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
      {visible.map((name) => {
        const cls =
          name === 'tenant_admin' ? 'bg-blue-100 text-blue-800' : 'bg-neutral-100 text-neutral-700'
        return (
          <span
            key={name}
            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}
          >
            {labelFor(name)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-neutral-50 text-neutral-600 border border-neutral-200"
          title={sorted.slice(3).map(labelFor).join(', ')}
        >
          +{overflow}
        </span>
      )}
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
// Reusable role-checkbox list
// ---------------------------------------------------------------------------

function RoleCheckboxList({
  options,
  selected,
  onChange,
  disabled,
  idPrefix,
}: {
  options: RoleOption[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  idPrefix: string
}) {
  function toggle(name: string) {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name))
    else onChange([...selected, name])
  }

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const id = `${idPrefix}-${opt.name}`
        const checked = selected.includes(opt.name)
        return (
          <label
            key={opt.name}
            htmlFor={id}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-muted/40"
          >
            <input
              id={id}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(opt.name)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Invite form
// ---------------------------------------------------------------------------

function InviteForm({
  tenantId,
  roleOptions,
  onSuccess,
  onCancel,
}: {
  tenantId: string
  roleOptions: RoleOption[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState('')
  const [roleNames, setRoleNames] = useState<string[]>(['tenant_user'])
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => inviteTenantUser(tenantId, { email, roleNames }),
    onSuccess: () => {
      onSuccess()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  function handleSubmit() {
    setError(null)
    if (roleNames.length === 0) {
      setError('Pick at least one role.')
      return
    }
    mutation.mutate()
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <h3 className="text-sm font-medium text-foreground">Invite user</h3>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="space-y-1">
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
        <label className="block text-xs font-medium text-muted-foreground">Roles</label>
        <RoleCheckboxList
          options={roleOptions}
          selected={roleNames}
          onChange={setRoleNames}
          disabled={mutation.isPending}
          idPrefix="invite-role"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={mutation.isPending}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={mutation.isPending || !email.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manage roles editor (inline)
// ---------------------------------------------------------------------------

function ManageRolesEditor({
  user,
  roleOptions,
  isLastActiveAdmin,
  onSave,
  onCancel,
  isPending,
}: {
  user: TenantUser
  roleOptions: RoleOption[]
  isLastActiveAdmin: boolean
  onSave: (roleNames: string[]) => void
  onCancel: () => void
  isPending: boolean
}) {
  const [selected, setSelected] = useState<string[]>(user.roleNames)
  const [error, setError] = useState<string | null>(null)

  const wouldRemoveLastAdmin = isLastActiveAdmin && !selected.includes('tenant_admin')

  function handleSave() {
    setError(null)
    if (selected.length === 0) {
      setError('Pick at least one role.')
      return
    }
    if (wouldRemoveLastAdmin) {
      setError(LAST_ADMIN_MESSAGE)
      return
    }
    onSave(selected)
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <div className="text-sm font-medium text-foreground">
        Manage roles for <span className="font-mono">{user.email}</span>
      </div>
      <RoleCheckboxList
        options={roleOptions}
        selected={selected}
        onChange={setSelected}
        disabled={isPending}
        idPrefix={`manage-role-${user.id}`}
      />
      {(error ?? (wouldRemoveLastAdmin ? LAST_ADMIN_MESSAGE : null)) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? LAST_ADMIN_MESSAGE}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isPending || wouldRemoveLastAdmin || selected.length === 0}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Saving…' : 'Save roles'}
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
  roleOptions,
  isLastActiveAdmin,
  isManaging,
  onStartManage,
  onStopManage,
  onMutated,
}: {
  user: TenantUser
  tenantId: string
  roleOptions: RoleOption[]
  isLastActiveAdmin: boolean
  isManaging: boolean
  onStartManage: () => void
  onStopManage: () => void
  onMutated: () => void
}) {
  const [rowError, setRowError] = useState<string | null>(null)

  const roleMutation = useMutation({
    mutationFn: (roleNames: string[]) => updateTenantUserRole(tenantId, user.id, roleNames),
    onSuccess: () => {
      setRowError(null)
      onStopManage()
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

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateTenantUser(tenantId, user.id),
    onSuccess: () => {
      setRowError(null)
      onMutated()
    },
    onError: (err) => {
      setRowError(err instanceof ApiError ? err.message : 'An unexpected error occurred.')
    },
  })

  const isPending =
    roleMutation.isPending || deactivateMutation.isPending || reactivateMutation.isPending

  return (
    <>
      <tr className="border-b border-border last:border-0">
        <td className="py-3 pr-4 text-sm text-foreground">{user.email}</td>
        <td className="py-3 pr-4">
          <RoleBadges roleNames={user.roleNames} roleOptions={roleOptions} />
        </td>
        <td className="py-3 pr-4">
          <StatusBadge status={user.status} />
        </td>
        <td className="py-3 pr-4 text-sm text-muted-foreground">{formatDate(user.invitedAt)}</td>
        <td className="py-3">
          <div className="flex items-center gap-2">
            {user.status !== 'DEACTIVATED' && (
              <button
                onClick={onStartManage}
                disabled={isPending}
                className="text-xs text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Manage roles
              </button>
            )}
            {user.status === 'DEACTIVATED' ? (
              <button
                onClick={() => reactivateMutation.mutate()}
                disabled={isPending}
                className="text-xs text-green-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reactivate
              </button>
            ) : (
              <button
                onClick={() => deactivateMutation.mutate()}
                disabled={isPending}
                className="text-xs text-destructive hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Deactivate
              </button>
            )}
          </div>
        </td>
      </tr>
      {(rowError ?? isManaging) && (
        <tr>
          <td colSpan={5} className="pb-3">
            {rowError && (
              <div className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {rowError}
              </div>
            )}
            {isManaging && (
              <ManageRolesEditor
                user={user}
                roleOptions={roleOptions}
                isLastActiveAdmin={isLastActiveAdmin}
                onSave={(roleNames) => roleMutation.mutate(roleNames)}
                onCancel={onStopManage}
                isPending={roleMutation.isPending}
              />
            )}
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
  const [managingUserId, setManagingUserId] = useState<string | null>(null)

  const { data, isPending, isError } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: () => listTenantUsers(tenantId),
  })

  const { data: roleOptions } = useQuery({
    queryKey: ['tenant-users-role-options', tenantId],
    queryFn: () => listTenantUserRoleOptions(tenantId),
    staleTime: Infinity,
  })

  function refetch() {
    void queryClient.invalidateQueries({ queryKey: ['tenant-users', tenantId] })
  }

  const users = data?.data ?? []
  const activeAdminCount = useMemo(
    () => users.filter((u) => u.status === 'ACTIVE' && u.roleNames.includes('tenant_admin')).length,
    [users],
  )

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

  return (
    <div className="space-y-4">
      {showInvite ? (
        <InviteForm
          tenantId={tenantId}
          roleOptions={roleOptions ?? []}
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
                  Roles
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
              {users.map((user) => {
                const isLastActiveAdmin =
                  user.status === 'ACTIVE' &&
                  user.roleNames.includes('tenant_admin') &&
                  activeAdminCount <= 1
                return (
                  <UserRow
                    key={user.id}
                    user={user}
                    tenantId={tenantId}
                    roleOptions={roleOptions ?? []}
                    isLastActiveAdmin={isLastActiveAdmin}
                    isManaging={managingUserId === user.id}
                    onStartManage={() => setManagingUserId(user.id)}
                    onStopManage={() => setManagingUserId(null)}
                    onMutated={refetch}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
