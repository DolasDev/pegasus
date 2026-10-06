// ---------------------------------------------------------------------------
// Desktop session — which companies a person may open in MoveManager
// (cloud identity I4; plans/todo/cloud-identity-and-companies.md, D-I8).
//
// This is where company membership becomes an ACCESS decision. Until I4 a
// membership was attribution only (`emp`/`wun`); bridge tokens are still minted
// for any signed-in user on the default company with no membership check, which
// is why the desktop token carries `scp=desktop` and the site serves a
// connection string only to that scope.
//
// Rules (Steve, 2026-10-06):
//   - A company is offered only if it is active AND its site has cloud auth on.
//     A site without cloud auth gets no credential from the cloud at all.
//   - A tenant_admin is offered every such company, linked or not, and may open
//     one without an employee row (the desktop's synthesized Wizard bootstrap).
//   - Anyone else is offered exactly the companies they hold a LINKED
//     membership in. INACTIVE (terminated employee) rows grant nothing.
//
// Pure — the handler feeds it rows; tested without a database.
// ---------------------------------------------------------------------------

import type { CompanyRow, SiteRow } from '../repositories/company.repository'

export const DESKTOP_BOOTSTRAP_ROLE = 'tenant_admin'

export type LinkedMembership = { employeeCode: number; legacyWindowsUsername: string | null }

export type DesktopCompany = {
  company: CompanyRow
  site: SiteRow
  /** null for a tenant_admin with no LINKED row in this company. */
  membership: LinkedMembership | null
}

export function canBootstrapDesktop(roleNames: readonly string[]): boolean {
  return roleNames.includes(DESKTOP_BOOTSTRAP_ROLE)
}

export function desktopCompanies(input: {
  companies: CompanyRow[]
  sites: SiteRow[]
  /** LINKED memberships of the caller, by companyId. */
  linked: Map<string, LinkedMembership>
  roleNames: readonly string[]
}): DesktopCompany[] {
  const siteById = new Map(input.sites.map((s) => [s.id, s]))
  const admin = canBootstrapDesktop(input.roleNames)
  const out: DesktopCompany[] = []
  for (const company of input.companies) {
    const site = siteById.get(company.siteId)
    if (!company.isActive || !site?.cloudAuthEnabled) continue
    const membership = input.linked.get(company.id) ?? null
    if (!membership && !admin) continue
    out.push({ company, site, membership })
  }
  return out
}

/**
 * Why a named company can't be opened — or null when it can. Distinguishes
 * "on a site that isn't on cloud auth yet" (an operator rollout state, 409)
 * from "not yours" (403) so the desktop can say which.
 */
export function desktopCompanyRefusal(
  companyId: string,
  input: Parameters<typeof desktopCompanies>[0],
): 'NOT_FOUND' | 'SITE_CLOUD_AUTH_DISABLED' | 'COMPANY_ACCESS_DENIED' | null {
  const company = input.companies.find((c) => c.id === companyId)
  if (!company) return 'NOT_FOUND'
  if (desktopCompanies(input).some((d) => d.company.id === companyId)) return null
  const site = input.sites.find((s) => s.id === company.siteId)
  const mayOpenOnceLive =
    company.isActive && (input.linked.has(companyId) || canBootstrapDesktop(input.roleNames))
  if (mayOpenOnceLive && !site?.cloudAuthEnabled) return 'SITE_CLOUD_AUTH_DISABLED'
  return 'COMPANY_ACCESS_DENIED'
}
