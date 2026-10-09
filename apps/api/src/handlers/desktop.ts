// ---------------------------------------------------------------------------
// /api/v1/desktop — MoveManager desktop sign-in through the cloud (cloud
// identity I4; plans/todo/cloud-identity-and-companies.md, D-I8).
//
// The desktop signs in on its own public app client — SSO through the Cognito
// Hosted UI (PKCE, loopback redirect), password in-app through InitiateAuth
// USER_PASSWORD_AUTH, never the Hosted UI's password page (see pre-token.ts) —
// and sends the resulting ID token here.
//
//   POST /session {}              → the company picker
//   POST /session { companyId }   → the picker + a pegII token for that company
//
// The token is the ordinary cloud-issued pegII token (aud = the company's site,
// `cid` = its dataSourceKey, `emp`/`wun` from the LINKED membership) plus
// `scp=desktop`, which pegII's desktop connection route requires. It lives
// ≤ 5 min (contract); the desktop calls this again to renew.
//
// Like /me and /device-tokens there is NO requirePermission gate: the access
// decision is the membership rule in services/desktop-session.ts, applied to
// the caller's OWN memberships (userId comes from the validated JWT, never the
// body). The site URL is NOT returned — the desktop keeps its own configured
// pegII URL (Steve, 2026-10-06); a token for the wrong site fails `aud` there.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { createCompanyRepository } from '../repositories/company.repository'
import { createCompanyMembershipRepository } from '../repositories/company-membership.repository'
import {
  canBootstrapDesktop,
  desktopCompanies,
  desktopCompanyRefusal,
} from '../services/desktop-session'
import { getPegiiTokenMinter, pegiiTokenExpiresAt } from '../lib/pegii-token'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

const SessionBody = z.object({ companyId: z.string().uuid().optional() }).strict()

export const desktopHandler = new Hono<AppEnv>()

desktopHandler.onError((err, c) => {
  if (err instanceof PegiiApiError) {
    const { status, code, message } = pegiiApiErrorToHttp(err)
    return c.json({ error: message, code }, status)
  }
  throw err
})

const REFUSAL_STATUS = {
  NOT_FOUND: 404,
  SITE_CLOUD_AUTH_DISABLED: 409,
  COMPANY_ACCESS_DENIED: 403,
} as const

const REFUSAL_MESSAGE = {
  NOT_FOUND: 'Company not found',
  SITE_CLOUD_AUTH_DISABLED:
    "This company's site is not on cloud sign-in yet. Ask your administrator to enable it.",
  COMPANY_ACCESS_DENIED: 'You are not linked to an employee in this company.',
} as const

desktopHandler.post(
  '/session',
  validator('json', (value, c) => {
    const r = SessionBody.safeParse(value ?? {})
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const db = c.get('db') as PrismaClient
    const { roleNames } = c.get('principal')
    const { companyId } = c.req.valid('json')

    if (!userId) {
      return c.json({ error: 'No tenant user resolved for this principal', code: 'NO_USER' }, 409)
    }
    const user = await db.tenantUser.findFirst({
      where: { id: userId, tenantId },
      select: { isServiceAccount: true, status: true },
    })
    if (!user || user.isServiceAccount || user.status === 'DEACTIVATED') {
      return c.json({ error: 'Desktop sign-in is for people only', code: 'FORBIDDEN' }, 403)
    }

    const companyRepo = createCompanyRepository(db)
    const [companies, sites, linked] = await Promise.all([
      companyRepo.listCompanies(),
      companyRepo.listSites(),
      createCompanyMembershipRepository(db).listLinkedForUser(userId),
    ])
    const input = { companies, sites, linked, roleNames }
    const offered = desktopCompanies(input)

    const body = {
      companies: offered.map(({ company, membership }) => ({
        id: company.id,
        code: company.code,
        displayName: company.displayName,
        siteId: company.siteId,
        isDefault: company.isDefault,
        employeeCode: membership?.employeeCode ?? null,
        winUsername: membership?.legacyWindowsUsername ?? null,
      })),
      bootstrapAllowed: canBootstrapDesktop(roleNames),
    }
    if (!companyId) return c.json({ data: body })

    const refusal = desktopCompanyRefusal(companyId, input)
    if (refusal) {
      logger.info('desktop session refused', { tenantId, userId, companyId, refusal })
      return c.json({ error: REFUSAL_MESSAGE[refusal], code: refusal }, REFUSAL_STATUS[refusal])
    }
    const chosen = offered.find((d) => d.company.id === companyId)!

    const token = await getPegiiTokenMinter().mint({
      tenantId,
      siteId: chosen.site.id,
      company: {
        dataSourceKey: chosen.company.dataSourceKey,
        systemEmployeeCode: chosen.company.systemEmployeeCode,
      },
      principal: {
        tenantUserId: userId,
        isServiceAccount: false,
        attribution: chosen.membership
          ? {
              employeeCode: chosen.membership.employeeCode,
              windowsUsername: chosen.membership.legacyWindowsUsername,
            }
          : null,
      },
      scope: 'desktop',
    })
    logger.info('desktop session issued', {
      tenantId,
      userId,
      companyId,
      siteId: chosen.site.id,
      linked: chosen.membership !== null,
    })

    return c.json({
      data: {
        ...body,
        session: {
          companyId,
          siteId: chosen.site.id,
          token,
          expiresAt: new Date(pegiiTokenExpiresAt(token) * 1000).toISOString(),
        },
      },
    })
  },
)
