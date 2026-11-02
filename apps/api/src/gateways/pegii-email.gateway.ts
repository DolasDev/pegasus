// ---------------------------------------------------------------------------
// pegII email gateway — sends one email through the tenant's on-prem pegII API
// (`POST /api/v1/pegii/email/send`), which relays it over the site's own SMTP
// account from the site's configured default address.
//
// The endpoint takes a cloud-issued token and is only mapped on sites with cloud
// auth configured, so the call first checks the site advertises
// `pegii.cloud-auth.v1` and `pegii.email.v1`; a site that doesn't gets
// PEGII_API_CAPABILITY_MISSING (→ 503) rather than an ambiguous 404. The token
// itself is minted by the client (lib/pegii-token.ts).
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import type { PegiiCaller } from '../lib/pegii-request-context'
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
  /** Who is calling; its correlation id is forwarded on the /version probe. */
  caller?: PegiiCaller
  requireCapabilities?: typeof requirePegiiCapabilities
}): EmailGateway {
  const requireCaps = opts.requireCapabilities ?? requirePegiiCapabilities
  return {
    async send(email) {
      await requireCaps(opts.baseUrl, [PegiiCapabilities.CloudAuth, PegiiCapabilities.Email], {
        ...(opts.caller ? { correlationId: opts.caller.correlationId } : {}),
      })
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
  /** Resolves the calling principal + company (cloud-issued token + x-correlation-id). */
  callerOf?: () => Promise<PegiiCaller>,
): Promise<EmailGateway> {
  const resolved = await resolvePegiiOverlayTarget(db, tenantId)
  if (!resolved.ok) {
    throw new PegiiApiError(
      'PEGII_API_NOT_CONFIGURED',
      `tenant ${tenantId} has no reachable pegII email source: ${resolved.message}`,
    )
  }
  const caller = callerOf ? await callerOf() : undefined
  return createPegiiEmailGateway({
    baseUrl: resolved.target.base,
    client: createPegiiApiClient({
      tenantId,
      baseUrl: resolved.target.base,
      ...(caller ? { caller } : {}),
    }),
    ...(caller ? { caller } : {}),
  })
}
