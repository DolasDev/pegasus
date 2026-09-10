// ---------------------------------------------------------------------------
// Cognito CustomMessage Lambda trigger
//
// Rewrites two of Cognito's stock emails:
//
//   CustomMessage_AdminCreateUser  → the invite (and, on a resend, the re-invite)
//   CustomMessage_ForgotPassword   → the password-reset code
//
// Every other source (resend code, attribute verification, …) is returned
// unchanged so Cognito's default email still goes out.
//
// ---------------------------------------------------------------------------
// SECURITY — `clientMetadata` is only trustworthy on the AdminCreateUser source
// ---------------------------------------------------------------------------
// `AdminCreateUser` is an IAM-gated admin API, so its callers (handlers/users.ts
// and handlers/admin/*) are ours and its metadata can be rendered into the body:
//   { source: 'tenant', tenantId, tenantName, tenantSlug, intent?: 'resend' }
//
// `ForgotPassword` is the opposite: a PUBLIC, UNAUTHENTICATED Cognito API that
// also accepts ClientMetadata. Anyone on the internet can invoke it for any
// address with metadata of their choosing. Rendering that into an email sent
// from our own domain would hand an attacker a phishing primitive — and
// escapeHtml would not help, because the payload is prose, not markup:
//
//     tenantName: "Your account is compromised — call 555-0100 to restore it"
//
// So the ForgotPassword branch reads NO metadata. Its copy is fixed and its
// link comes from SSM. The only per-recipient value it uses is the address
// Cognito is already mailing (`request.userAttributes.email`).
//
// That also settles the admin-initiated reset: there is no
// `CustomMessage_AdminResetUserPassword` trigger source, so
// AdminResetUserPassword (POST /users/:id/reset-password) arrives here as
// `CustomMessage_ForgotPassword`, indistinguishable from a self-service reset.
// The copy is therefore worded to be true of both.
//
// Fail-safe: any unexpected error returns the event unchanged so Cognito
// emits its default email rather than swallowing the message silently.
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

/**
 * How long a Cognito temporary password stays valid.
 *
 * Source of truth: `tempPasswordValidity` in the `passwordPolicy` block of
 * `packages/infra/lib/stacks/cognito-stack.ts`. Keep this in sync if that
 * duration changes — same arrangement as PASSWORD_POLICY_MESSAGE in
 * `packages/auth/src/cognito-client.ts`. It is duplicated rather than passed in
 * as an env var so a wording change never requires a cognito-stack deploy.
 */
const TEMP_PASSWORD_VALIDITY_DAYS = 7

interface InviteContext {
  tenantName: string
  loginUrl: string
}

async function resolveInviteContext(
  metadata: Record<string, string> | undefined,
  email: string,
): Promise<InviteContext> {
  // The fallback path also handles missing/unrecognized metadata so the email
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

  // Default branch: tenant-source invites and any unrecognized source.
  const base = await getTenantBase()
  return {
    tenantName,
    loginUrl: `${base}/login?email=${encodeURIComponent(email)}`,
  }
}

/**
 * The invite email, and its re-invite variant.
 *
 * `isResend` is driven by `intent: 'resend'` in the AdminCreateUser metadata
 * (set by `resendCognitoInvite`). A resend re-fires this same trigger source, so
 * without it the recipient of a re-invite would get "You've been invited",
 * identical to the first one, with no hint that the earlier temporary password
 * had just been invalidated.
 *
 * Both variants state the expiry. Not doing so is what stranded the user who
 * prompted this: nothing they had ever been sent said the password had a
 * lifetime, so a dead password looked like a broken account.
 */
function renderInviteEmail(
  ctx: InviteContext,
  usernameParameter: string,
  codeParameter: string,
  isResend: boolean,
): { subject: string; body: string } {
  const safeName = escapeHtml(ctx.tenantName)
  const days = TEMP_PASSWORD_VALIDITY_DAYS

  const subject = isResend
    ? `Your new temporary password for ${safeName} on Pegasus`
    : `You're invited to ${safeName} on Pegasus`

  const opening = isResend
    ? `<p>Your invitation to <strong>${safeName}</strong> on Pegasus has been re-sent with a new temporary password.</p>`
    : `<p>You've been invited to <strong>${safeName}</strong> on Pegasus.</p>`

  // A resend invalidates whatever was issued before, so say so — otherwise
  // someone holding two invite emails cannot tell which password is live.
  const closing = isResend
    ? `<p>Any temporary password from an earlier invitation no longer works. This one expires in ${days} days.</p>`
    : `<p>This temporary password expires in ${days} days. If it does, ask your administrator to resend your invitation.</p>`

  // Cognito requires the literal usernameParameter and codeParameter strings
  // to appear in the body. They're substituted at send time with the real
  // username (the invitee's email) and the temporary password, respectively.
  const body =
    `<p>Hello,</p>` +
    opening +
    `<p>Username: <strong>${usernameParameter}</strong><br/>` +
    `Temporary password: <strong>${codeParameter}</strong></p>` +
    // Cognito issues a NEW_PASSWORD_REQUIRED challenge partway through sign-in,
    // so choosing a password is part of signing in — not an optional thing to
    // remember afterwards, which is what the previous wording implied.
    `<p><a href="${ctx.loginUrl}">Sign in to ${safeName}</a>. You'll be asked to choose a permanent password as you sign in.</p>` +
    closing

  return { subject, body }
}

/**
 * The password-reset email.
 *
 * Renders NOTHING from `clientMetadata` — see the security note in the file
 * header. `loginUrl` comes from SSM and the address from Cognito's own
 * userAttributes.
 *
 * Wording has to hold for both a self-service "Forgot password?" and an
 * admin-initiated reset (`POST /users/:id/reset-password`), which are the same
 * trigger source. That rules out saying who started it, and it rules out the
 * reassurance you would normally give ("your current password still works") —
 * AdminResetUserPassword moves the account straight to RESET_REQUIRED, so for
 * that half the old password has already stopped working.
 */
function renderResetEmail(
  loginUrl: string,
  codeParameter: string,
): { subject: string; body: string } {
  return {
    subject: 'Your Pegasus password reset code',
    body:
      `<p>Hello,</p>` +
      `<p>A password reset was requested for your Pegasus account.</p>` +
      `<p>Your reset code: <strong>${codeParameter}</strong></p>` +
      `<p>To use it, open the <a href="${loginUrl}">Pegasus sign-in page</a>, choose ` +
      `&ldquo;Forgot password?&rdquo;, and enter this code along with your new password.</p>` +
      `<p>If you weren't expecting this, contact your administrator.</p>`,
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export const handler: CustomMessageTriggerHandler = async (event) => {
  const isInvite = event.triggerSource === 'CustomMessage_AdminCreateUser'
  const isReset = event.triggerSource === 'CustomMessage_ForgotPassword'
  if (!isInvite && !isReset) {
    return event
  }

  try {
    const email = event.request.userAttributes['email'] ?? ''

    if (isReset) {
      // Deliberately no clientMetadata: this source is publicly invocable.
      const base = await getTenantBase()
      const { subject, body } = renderResetEmail(
        `${base}/login?email=${encodeURIComponent(email)}`,
        event.request.codeParameter ?? '{####}',
      )
      event.response.emailSubject = subject
      event.response.emailMessage = body
      return event
    }

    const metadata = event.request.clientMetadata as Record<string, string> | undefined
    const ctx = await resolveInviteContext(metadata, email)

    const { subject, body } = renderInviteEmail(
      ctx,
      event.request.usernameParameter ?? '{username}',
      event.request.codeParameter ?? '{####}',
      metadata?.['intent'] === 'resend',
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
