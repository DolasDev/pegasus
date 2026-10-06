import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleCheckboxList } from '@/components/RoleCheckboxList'
import type { DirectoryEmployee } from '@/api/companies'
import { companiesQueryOptions, companyDirectoryQueryOptions } from '@/api/queries/companies'
import { ssoProvidersQueryOptions } from '@/api/queries/sso'
import {
  useImportUsers,
  type ImportUserResult,
  type ImportUsersResponse,
  type RoleOption,
} from '@/api/queries/users'
import { companySiteErrorMessage } from '@/lib/company-site-errors'

// ---------------------------------------------------------------------------
// Users → "Add from pegII"
//
// Pick employees from a company's pegII directory and create their logins in
// one go. "Send invite" is optional: off means SSO-only — no email, no
// password; the person signs in with the tenant's SSO provider, matched by the
// email pegII holds. The server re-reads the directory, so only employee codes
// leave the browser.
// ---------------------------------------------------------------------------

/** Most employees one request may add — mirrors the API's IMPORT_MAX. */
export const ADD_FROM_PEGII_MAX = 50

const selectClass =
  'mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

const REASON_TEXT: Record<NonNullable<ImportUserResult['reason']>, string> = {
  NOT_IN_DIRECTORY: 'no longer in the directory',
  INACTIVE: 'inactive in pegII',
  NO_EMAIL: 'no email in pegII',
  ALREADY_A_USER: 'already a user',
  ACTIVE_IN_ANOTHER_TENANT: 'already signs in to another Pegasus account — use Invite user',
  COGNITO_ERROR: 'the sign-in account could not be created',
  ERROR: 'unexpected error',
}

function unavailableReason(e: DirectoryEmployee): string | null {
  if (e.existingUserId) return 'Already a user'
  if (!e.email) return 'No email in pegII'
  return null
}

function matches(e: DirectoryEmployee, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return [e.name, e.email ?? '', String(e.code), e.branch ?? ''].some((v) =>
    v.toLowerCase().includes(q),
  )
}

function EmployeePickList({
  employees,
  selected,
  onToggle,
}: {
  employees: DirectoryEmployee[]
  selected: Set<number>
  onToggle: (code: number) => void
}) {
  if (employees.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</p>
  }
  return (
    <ul className="max-h-80 divide-y overflow-y-auto rounded-md border" aria-label="Employees">
      {employees.map((e) => {
        const reason = unavailableReason(e)
        const id = `pegii-employee-${e.code}`
        return (
          <li key={e.code} className="flex items-center gap-3 px-3 py-2">
            <input
              id={id}
              type="checkbox"
              className="h-4 w-4"
              disabled={reason !== null}
              checked={selected.has(e.code)}
              onChange={() => onToggle(e.code)}
            />
            <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
              <span className={reason ? 'text-muted-foreground' : 'font-medium'}>{e.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {e.email ?? '—'} · #{e.code}
                {e.branch ? ` · branch ${e.branch}` : ''}
              </span>
            </label>
            {reason && <span className="shrink-0 text-xs text-muted-foreground">{reason}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function ResultList({ response }: { response: ImportUsersResponse }) {
  const sync = response.membershipSync
  return (
    <div className="space-y-3" role="status">
      <p className="text-sm">
        {response.created} user{response.created === 1 ? '' : 's'} added.
        {sync && 'error' in sync && <span className="text-destructive"> {sync.error}</span>}
        {sync && !('error' in sync) && (
          <span className="text-muted-foreground">
            {' '}
            Linked to their employee records: {sync.linked}
            {sync.ambiguous > 0 ? ` (${sync.ambiguous} ambiguous — see Settings → Companies)` : ''}.
          </span>
        )}
      </p>
      <ul className="divide-y rounded-md border text-sm">
        {response.results.map((r) => (
          <li key={r.code} className="flex justify-between gap-3 px-3 py-2">
            <span>{r.email ?? `#${r.code}`}</span>
            <span
              className={
                r.status === 'failed'
                  ? 'text-destructive'
                  : r.status === 'skipped'
                    ? 'text-muted-foreground'
                    : ''
              }
            >
              {r.status === 'invited' && 'Invited (email sent)'}
              {r.status === 'created' && 'Added — signs in with SSO'}
              {(r.status === 'skipped' || r.status === 'failed') &&
                `${r.status === 'failed' ? 'Failed' : 'Skipped'}: ${r.reason ? REASON_TEXT[r.reason] : ''}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AddFromPegiiPanel({
  roleOptions,
  onDone,
}: {
  roleOptions: RoleOption[]
  onDone: () => void
}) {
  const companies = useQuery(companiesQueryOptions)
  const sso = useQuery(ssoProvidersQueryOptions)
  const [companyId, setCompanyId] = useState<string>('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [roleNames, setRoleNames] = useState<string[]>(['viewer'])
  const [sendInvite, setSendInvite] = useState(false)
  const importUsers = useImportUsers()

  const companyList = companies.data?.companies.filter((c) => c.isActive) ?? []
  useEffect(() => {
    if (!companyId && companyList.length > 0) {
      setCompanyId((companyList.find((c) => c.isDefault) ?? companyList[0]!).id)
    }
  }, [companyId, companyList])

  const directory = useQuery({ ...companyDirectoryQueryOptions(companyId), enabled: !!companyId })
  const ssoAvailable = sso.data?.providers.some((p) => p.isEnabled) ?? false
  // Without an enabled SSO provider an SSO-only user could never sign in.
  const effectiveSendInvite = sendInvite || (!sso.isPending && !ssoAvailable)

  const visible = useMemo(
    () => (directory.data ?? []).filter((e) => matches(e, query.trim())),
    [directory.data, query],
  )
  const selectableVisible = visible.filter((e) => unavailableReason(e) === null)
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((e) => selected.has(e.code))

  function toggle(code: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const e of selectableVisible) {
        if (allVisibleSelected) next.delete(e.code)
        else next.add(e.code)
      }
      return next
    })
  }

  function changeCompany(id: string) {
    setCompanyId(id)
    setSelected(new Set())
    importUsers.reset()
  }

  const tooMany = selected.size > ADD_FROM_PEGII_MAX
  const canSubmit =
    selected.size > 0 && !tooMany && roleNames.length > 0 && !importUsers.isPending && !!companyId

  if (importUsers.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Add users from pegII</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResultList response={importUsers.data} />
          <div className="flex justify-end">
            <Button onClick={onDone}>Done</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add users from pegII</CardTitle>
        <CardDescription>
          Choose employees from a company's pegII directory. Their login email is the email pegII
          holds for them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {companies.isPending ? (
          <p className="text-sm text-muted-foreground">Loading companies…</p>
        ) : companyList.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No companies yet — your tenant isn't connected to a pegII site.
          </p>
        ) : (
          <>
            {companyList.length > 1 && (
              <div>
                <Label htmlFor="pegii-company">Company</Label>
                <select
                  id="pegii-company"
                  className={selectClass}
                  value={companyId}
                  onChange={(e) => changeCompany(e.target.value)}
                >
                  {companyList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} ({c.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {directory.isPending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the employee directory…
              </p>
            ) : directory.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {companySiteErrorMessage(directory.error, 'Could not read the employee directory.')}
              </p>
            ) : (
              <>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <Label htmlFor="pegii-search">Search</Label>
                    <Input
                      id="pegii-search"
                      placeholder="Name, email, code or branch"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectableVisible.length === 0}
                    onClick={toggleAllVisible}
                  >
                    {allVisibleSelected
                      ? 'Clear shown'
                      : `Select all shown (${selectableVisible.length})`}
                  </Button>
                </div>
                <EmployeePickList employees={visible} selected={selected} onToggle={toggle} />
                <p className={`text-xs ${tooMany ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {selected.size} selected
                  {tooMany && ` — at most ${ADD_FROM_PEGII_MAX} at a time`}
                </p>
              </>
            )}

            <div>
              <Label>Roles</Label>
              <RoleCheckboxList
                options={roleOptions}
                selected={roleNames}
                onChange={setRoleNames}
                idPrefix="pegii-role"
              />
            </div>

            <div className="flex items-start gap-2">
              <input
                id="pegii-send-invite"
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={effectiveSendInvite}
                disabled={!ssoAvailable}
                onChange={(e) => setSendInvite(e.target.checked)}
              />
              <div>
                <Label htmlFor="pegii-send-invite">Send invite</Label>
                <p className="text-xs text-muted-foreground">
                  {effectiveSendInvite
                    ? 'Each person is emailed a temporary password to set their own.'
                    : "No email is sent and no password is set. They sign in with your SSO provider, using the email pegII holds — it must match their SSO account's email."}
                  {!sso.isPending &&
                    !ssoAvailable &&
                    ' SSO is not set up for this account, so an invite is required.'}
                </p>
              </div>
            </div>

            {importUsers.isError && (
              <p className="text-sm text-destructive" role="alert">
                {companySiteErrorMessage(importUsers.error, 'Adding users failed.')}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onDone}>
                Cancel
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={() =>
                  importUsers.mutate({
                    companyId,
                    employeeCodes: [...selected],
                    roleNames,
                    sendInvite: effectiveSendInvite,
                  })
                }
              >
                {importUsers.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add {selected.size || ''} user{selected.size === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
