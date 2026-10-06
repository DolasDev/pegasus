import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError } from '@/api/client'
import { companySiteErrorMessage } from '@/lib/company-site-errors'
import type { Company, MembershipSyncResult } from '@/api/companies'
import {
  companiesQueryOptions,
  companyMembershipsQueryOptions,
  useSyncCompanyMemberships,
  useUpdateCompanySystemEmployee,
} from '@/api/queries/companies'

// ---------------------------------------------------------------------------
// Settings → Companies (cloud identity I3)
//
// Each company is one legacy company database on a pegII site. "Sync employees"
// links the tenant's users to that company's employee rows (by email, then
// Windows username), so writes made through the cloud are attributed to the
// right person on the legacy side. Attribution only — it grants no access.
// ---------------------------------------------------------------------------

const inputClass =
  'w-28 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring'

/** A sync failure the admin can act on, phrased for the site's state. */
export function syncErrorMessage(error: unknown): string {
  return companySiteErrorMessage(error, 'Sync failed.')
}

function SyncSummary({ result }: { result: MembershipSyncResult }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {result.employees} employees read · {result.linked} linked ({result.newlyLinked} new) ·{' '}
      {result.deactivated} deactivated · {result.unmatched} unmatched
      {result.ambiguous > 0 && (
        <span className="text-destructive"> · {result.ambiguous} ambiguous (not linked)</span>
      )}
    </p>
  )
}

function SystemEmployeeEditor({ company }: { company: Company }) {
  const [value, setValue] = useState(company.systemEmployeeCode?.toString() ?? '')
  const update = useUpdateCompanySystemEmployee()
  const parsed = value.trim() === '' ? null : Number(value)
  const valid = parsed === null || (Number.isInteger(parsed) && parsed > 0)
  const dirty = parsed !== company.systemEmployeeCode

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={`System employee code for ${company.code}`}
        className={inputClass}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="none"
      />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          disabled={!valid || update.isPending}
          onClick={() => update.mutate({ id: company.id, code: parsed })}
        >
          Save
        </Button>
      )}
      {update.isError && (
        <span className="text-xs text-destructive">
          {update.error instanceof ApiError ? update.error.message : 'Save failed.'}
        </span>
      )}
    </div>
  )
}

function CompanyCard({ company }: { company: Company }) {
  const memberships = useQuery(companyMembershipsQueryOptions(company.id))
  const sync = useSyncCompanyMemberships(company.id)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {company.displayName}
              <span className="font-mono text-sm text-muted-foreground">{company.code}</span>
              {company.isDefault && <Badge variant="info">Default</Badge>}
            </CardTitle>
            <CardDescription>
              Database:{' '}
              {company.dataSourceKey ? (
                <span className="font-mono">{company.dataSourceKey}</span>
              ) : (
                "the site's default database"
              )}
            </CardDescription>
          </div>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
            {sync.isPending ? 'Syncing…' : 'Sync employees'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">System employee for automations:</span>
          <SystemEmployeeEditor company={company} />
        </div>

        {sync.isError && (
          <p className="text-sm text-destructive" role="alert">
            {syncErrorMessage(sync.error)}
          </p>
        )}
        {sync.data && <SyncSummary result={sync.data} />}

        {memberships.isPending ? (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        ) : memberships.isError ? (
          <p className="text-sm text-destructive">
            {memberships.error instanceof ApiError
              ? memberships.error.message
              : 'Failed to load members.'}
          </p>
        ) : (
          <>
            {memberships.data.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No linked employees yet. Run a sync to match users to this company's employees.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Employee code</TableHead>
                    <TableHead>Windows username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Matched by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships.data.members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.email}</TableCell>
                      <TableCell className="font-mono">{m.employeeCode}</TableCell>
                      <TableCell className="font-mono">{m.legacyWindowsUsername ?? '—'}</TableCell>
                      <TableCell>
                        {m.status === 'LINKED' ? (
                          <Badge variant="success">Linked</Badge>
                        ) : (
                          <Badge variant="muted">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.matchedBy === 'EMAIL' ? 'Email' : 'Windows username'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {memberships.data.unmatched.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">
                  Not linked in this company ({memberships.data.unmatched.length})
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  No employee here has their email. Set their Windows username on{' '}
                  <Link to="/settings/users" className="text-primary hover:underline">
                    Users
                  </Link>
                  , then sync again.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {memberships.data.unmatched.map((u) => (
                    <li key={u.id}>
                      <Badge variant="outline">{u.email}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function CompaniesSettingsPage() {
  const { data, isPending, isError, error } = useQuery(companiesQueryOptions)

  return (
    <div>
      <PageHeader title="Companies" breadcrumbs={[{ label: 'Settings' }, { label: 'Companies' }]} />
      <p className="mt-2 text-sm text-muted-foreground">
        Each company is one legacy company database. Syncing links your users to that company's
        employee records, so changes made through Pegasus are recorded under the right person.
        Linking never grants access.
      </p>

      <div className="mt-6">
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Failed to load companies.'}
          </p>
        ) : data.companies.length === 0 ? (
          <EmptyState
            title="No companies"
            description="Companies appear here once your tenant is connected to a pegII site."
          />
        ) : (
          <div className="space-y-4">
            {data.companies.map((company) => (
              <CompanyCard key={company.id} company={company} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
