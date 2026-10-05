import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Companies — the tenant's legal entities (one legacy company database each),
// reached through on-prem pegII sites, and each company's employee memberships
// (cloud identity I3). Mirrors apps/api/src/handlers/settings-companies.ts.
// ---------------------------------------------------------------------------

export interface Site {
  id: string
  name: string
  cloudAuthEnabled: boolean
}

export interface Company {
  id: string
  siteId: string
  code: string
  displayName: string
  /** The site's SpokeConnections key; null = the site's default database. */
  dataSourceKey: string | null
  /** Employee stamped on automation/API writes in this company. */
  systemEmployeeCode: number | null
  isDefault: boolean
  isActive: boolean
}

export interface CompaniesResponse {
  sites: Site[]
  companies: Company[]
}

export interface CompanyMember {
  id: string
  tenantUserId: string
  email: string
  employeeCode: number
  legacyWindowsUsername: string | null
  status: 'LINKED' | 'INACTIVE'
  matchedBy: 'EMAIL' | 'WIN_USERNAME'
  lastSyncedAt: string
}

export interface CompanyMemberships {
  members: CompanyMember[]
  unmatched: Array<{ id: string; email: string; legacyWindowsUsername: string | null }>
}

export interface MembershipSyncResult {
  employees: number
  linked: number
  newlyLinked: number
  deactivated: number
  unmatched: number
  ambiguous: number
  unmatchedUserIds: string[]
  ambiguousMatches: Array<{
    kind: 'user' | 'employee'
    tenantUserIds: string[]
    employeeCodes: number[]
  }>
}

export function listCompanies(): Promise<CompaniesResponse> {
  return apiFetch<CompaniesResponse>('/api/v1/settings/companies')
}

export function updateCompanySystemEmployee(
  id: string,
  systemEmployeeCode: number | null,
): Promise<Company> {
  return apiFetch<Company>(`/api/v1/settings/companies/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ systemEmployeeCode }),
  })
}

export function getCompanyMemberships(id: string): Promise<CompanyMemberships> {
  return apiFetch<CompanyMemberships>(
    `/api/v1/settings/companies/${encodeURIComponent(id)}/memberships`,
  )
}

export function syncCompanyMemberships(id: string): Promise<MembershipSyncResult> {
  return apiFetch<MembershipSyncResult>(
    `/api/v1/settings/companies/${encodeURIComponent(id)}/membership-sync`,
    { method: 'POST' },
  )
}
