// ---------------------------------------------------------------------------
// Support channel — feature switch + operator alert (plan: support-channel.md,
// Phase 1a, decision D8).
//
// SUPPORT_ENABLED (set by CDK) gates every /api/v1/support and
// /api/admin/support route and the `support` capability on /me. Absent is off.
//
// The operator alert is one SNS publish to SUPPORT_ALERT_TOPIC_ARN, which CDK
// subscribes the operator's email to. It carries the tenant, the thread subject
// and an admin-web link — not the message body, so most customer text stays out
// of a mailbox outside Pegasus. Caveat: a thread opened without a subject takes
// its subject from the message's first line, so a one-line message does reach
// the email in full. Best-effort: a failed publish is logged and the
// customer's message still stands; the admin inbox is the source of truth.
// ---------------------------------------------------------------------------

import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import { logger } from './logger'

export function supportEnabled(): boolean {
  return process.env['SUPPORT_ENABLED'] === 'true'
}

/** The admin-web page for a thread, or null when the admin URL isn't configured. */
export function supportThreadAdminUrl(threadId: string): string | null {
  const base = (process.env['SUPPORT_ADMIN_URL'] ?? '').replace(/\/+$/, '')
  return base ? `${base}/support/${threadId}` : null
}

export interface SupportAlertInput {
  id: string
  subject: string
  tenantName: string
  /** First message of a brand-new thread, as opposed to a later customer message. */
  isNewThread: boolean
}

/**
 * SNS rejects a Subject with a line break or control character, or of 100+
 * characters (InvalidParameter), which would drop the whole alert. The current
 * Publish API reference allows UTF-8; older SDK docs said ASCII only.
 */
const MAX_SNS_SUBJECT = 99

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function noControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return s.replace(/[\u0000-\u001F\u007F]/g, '')
}

export function supportAlertContent(t: SupportAlertInput): { subject: string; message: string } {
  const kind = t.isNewThread ? 'New thread' : 'New message'
  let subject = noControlChars(`[Pegasus support] ${kind} - ${oneLine(t.tenantName)}`)
  if (subject.length > MAX_SNS_SUBJECT) subject = `${subject.slice(0, MAX_SNS_SUBJECT - 3)}...`
  const link = supportThreadAdminUrl(t.id)
  const message = [
    `${kind} from ${oneLine(t.tenantName)}`,
    `Subject: ${oneLine(t.subject)}`,
    link ? `Open: ${link}` : `Thread id: ${t.id}`,
  ].join('\n')
  return { subject, message }
}

let _client: SNSClient | null = null
function getClient(): SNSClient {
  return (_client ??= new SNSClient({}))
}

/** Override the SNSClient. Tests inject a stub with a mocked `send`. */
export function setSupportAlertSnsClient(client: SNSClient | null): void {
  _client = client
}

/** Alerts the operator about a customer message. Returns whether it was published. */
export async function alertOperator(t: SupportAlertInput): Promise<boolean> {
  const topicArn = process.env['SUPPORT_ALERT_TOPIC_ARN']
  if (!topicArn) return false
  const { subject, message } = supportAlertContent(t)
  try {
    await getClient().send(
      new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }),
    )
    return true
  } catch (err) {
    // `error`, not `warn`: the operator silently missing a customer is a real
    // failure (bad IAM, deleted topic), even though the post itself succeeded.
    logger.error('support operator alert failed', { threadId: t.id, error: String(err) })
    return false
  }
}
