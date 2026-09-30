// ---------------------------------------------------------------------------
// pegII email gateway — sends one email through the tenant's on-prem pegII API
// (`POST /api/v1/pegii/email/send`), which relays it over the site's own SMTP
// account from the site's configured default address.
//
// The endpoint is JWT-protected and only mapped on sites with auth configured,
// so the call first checks the site advertises `pegii.auth.v1` and
// `pegii.email.v1`; a site that doesn't gets PEGII_API_CAPABILITY_MISSING
// (→ 503) rather than an ambiguous 404. The service-user login itself lives
// in the client (lib/pegii-auth.ts).
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { createPegiiApiClient, PegiiApiError, type PegiiApiClient } from '../lib/pegii-api-client'
import { resolvePegiiOverlayTarget } from '../lib/pegii-overlay-target'
import { requirePegiiCapabilities, PegiiCapabilities } from '../lib/pegii-capabilities'

export interface PegiiEmail {
  to: string[]
  cc: string[]
  subject: string
  body: string
  bodyType: 'text' | 'html'
}

export interface EmailGateway {
  send(email: PegiiEmail): Promise<void>
}

export function createPegiiEmailGateway(opts: {
  baseUrl: string
  client: PegiiApiClient
  requireCapabilities?: typeof requirePegiiCapabilities
}): EmailGateway {
  const requireCaps = opts.requireCapabilities ?? requirePegiiCapabilities
  return {
    async send(email) {
      await requireCaps(opts.baseUrl, [PegiiCapabilities.Auth, PegiiCapabilities.Email])
      await opts.client.post('/api/v1/pegii/email/send', {
        to: email.to,
        cc: email.cc,
        subject: email.subject,
        body: email.body,
        body_type: email.bodyType,
      })
    },
  }
}

/** Resolve the tenant's pegII target; throws PEGII_API_NOT_CONFIGURED when it has none. */
export async function resolveEmailGateway(
  db: PrismaClient,
  tenantId: string,
): Promise<EmailGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII email source: ${resolved.message}`,
    )
  }
  return createPegiiEmailGateway({
    baseUrl: resolved.target.base,
    client: createPegiiApiClient({
      tenantId,
      baseUrl: resolved.target.base,
      apiKey: resolved.target.apiKey,
    }),
  })
}
