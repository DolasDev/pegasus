// ---------------------------------------------------------------------------
// Cognito CustomMessage Lambda trigger
//
// Replaces Cognito's default invite email (AdminCreateUser) with a tenant-aware
// version that names the tenant and links to the correct login page so the
// recipient does not have to figure out which sub-domain to visit.
//
// Only the `CustomMessage_AdminCreateUser` source is rewritten. Any other
// custom-message event (forgot-password, resend code, attribute verification,
// etc.) is returned unchanged so Cognito's default email still goes out.
//
// Tenant context is supplied by the calling handler via `ClientMetadata`:
//   { source: 'tenant', tenantId, tenantName, tenantSlug }
// `source` is reserved for a future admin-portal invite path. Today the only
// recognised value is `tenant`; anything else falls back to a generic body.
//
// Fail-safe: any unexpected error returns the event unchanged so Cognito
// emits its default email rather than swallowing the invite silently.
// ---------------------------------------------------------------------------

import type { CustomMessageTriggerHandler } from 'aws-lambda'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { createLogger } from '../lib/logger'

const logger = createLogger('pegasus-custom-message')

const ssm = new SSMClient({})

// ---------------------------------------------------------------------------
// SSM-backed login URL bases
//
// Reading from SSM (instead of an env var) avoids a CloudFormation circular
// dependency between the Lambda and the SSM parameter constructs that hold
// the front-end domain names.
// ---------------------------------------------------------------------------
const TENANT_DOMAIN_PARAM = '/dolas/pegasus/web/domain-name'
const ADMIN_DOMAIN_PARAM = '/dolas/pegasus/admin/domain-name'

let _tenantBase: string | null = null
let _adminBase: string | null = null

async function readSsmParam(name: string): Promise<string | null> {
  const result = await ssm.send(new GetParameterCommand({ Name: name }))
  return result.Parameter?.Value ?? null
}

function withScheme(value: string): string {
  return value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`
}

async function getTenantBase(): Promise<string> {
  if (_tenantBase) return _tenantBase
  const fromSsm = await readSsmParam(TENANT_DOMAIN_PARAM)
  const fromEnv = process.env['TENANT_LOGIN_URL_FALLBACK']
  const value = (fromSsm && withScheme(fromSsm)) || fromEnv || 'http://localhost:5173'
  _tenantBase = value
  return value
}

async function getAdminBase(): Promise<string> {
  if (_adminBase) return _adminBase
  const fromSsm = await readSsmParam(ADMIN_DOMAIN_PARAM)
  const fromEnv = process.env['ADMIN_LOGIN_URL_FALLBACK']
  const value = (fromSsm && withScheme(fromSsm)) || fromEnv || 'http://localhost:5174'
  _adminBase = value
  return value
}

// ---------------------------------------------------------------------------
// HTML escaping — defends against tenant names containing markup. Tenant
// names are operator-supplied and reach the inbox of every invitee, so we
// treat them as untrusted from the trigger's perspective.
// ---------------------------------------------------------------------------
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface InviteContext {
  tenantName: string
  loginUrl: string
}

async function resolveInviteContext(
  metadata: Record<string, string> | undefined,
  email: string,
): Promise<InviteContext> {
  // The fallback path also handles missing/unrecognised metadata so the email
  // still contains a usable link rather than failing the trigger.
  const source = metadata?.['source']
  const tenantName = metadata?.['tenantName'] ?? 'Pegasus'

  if (source === 'admin') {
    const base = await getAdminBase()
    return {
      tenantName,
      loginUrl: `${base}/login?email=${encodeURIComponent(email)}`,
    }
  }

  // Default branch: tenant-source invites and any unrecognised source.
  const base = await getTenantBase()
  return {
    tenantName,
    loginUrl: `${base}/login?email=${encodeURIComponent(email)}`,
  }
}

function renderEmail(
  ctx: InviteContext,
  usernameParameter: string,
  codeParameter: string,
): { subject: string; body: string } {
  const safeName = escapeHtml(ctx.tenantName)

  const subject = `You're invited to ${safeName} on Pegasus`

  // Cognito requires the literal usernameParameter and codeParameter strings
  // to appear in the body. They're substituted at send time with the real
  // username (the invitee's email) and the temporary password, respectively.
  const body =
    `<p>Hello,</p>` +
    `<p>You've been invited to <strong>${safeName}</strong> on Pegasus.</p>` +
    `<p>Username: <strong>${usernameParameter}</strong><br/>` +
    `Temporary password: <strong>${codeParameter}</strong></p>` +
    `<p><a href="${ctx.loginUrl}">Sign in to ${safeName}</a> to finish setting up your account.</p>` +
    `<p>For your security, please change your temporary password after signing in.</p>`

  return { subject, body }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export const handler: CustomMessageTriggerHandler = async (event) => {
  if (event.triggerSource !== 'CustomMessage_AdminCreateUser') {
    return event
  }

  try {
    const email = event.request.userAttributes['email'] ?? ''
    const ctx = await resolveInviteContext(
      event.request.clientMetadata as Record<string, string> | undefined,
      email,
    )

    const { subject, body } = renderEmail(
      ctx,
      event.request.usernameParameter ?? '{username}',
      event.request.codeParameter ?? '{####}',
    )

    event.response.emailSubject = subject
    event.response.emailMessage = body
    return event
  } catch (err) {
    // Fail-safe: never bubble out of the trigger. Cognito will fall back to
    // its built-in invite email so the invitee is not stranded.
    logger.error('CustomMessage trigger: render failed, returning event unchanged', {
      error: err instanceof Error ? err.message : String(err),
      triggerSource: event.triggerSource,
    })
    return event
  }
}
