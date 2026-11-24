import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SNSClient } from '@aws-sdk/client-sns'
import {
  alertOperator,
  setSupportAlertSnsClient,
  supportAlertContent,
  supportEnabled,
  supportThreadAdminUrl,
} from './support-alert'

function stub(send: ReturnType<typeof vi.fn>) {
  setSupportAlertSnsClient({ send } as unknown as SNSClient)
}

afterEach(() => {
  delete process.env['SUPPORT_ENABLED']
  delete process.env['SUPPORT_ALERT_TOPIC_ARN']
  delete process.env['SUPPORT_ADMIN_URL']
  setSupportAlertSnsClient(null)
})

const thread = {
  id: 'th-1',
  subject: 'Invoice totals look wrong',
  tenantName: 'Acme Movers',
  isNewThread: true,
}

describe('supportEnabled', () => {
  it('is on only when SUPPORT_ENABLED is exactly "true"', () => {
    expect(supportEnabled()).toBe(false)
    process.env['SUPPORT_ENABLED'] = 'yes'
    expect(supportEnabled()).toBe(false)
    process.env['SUPPORT_ENABLED'] = 'true'
    expect(supportEnabled()).toBe(true)
  })
})

describe('supportThreadAdminUrl', () => {
  it('links to the admin-web thread, ignoring a trailing slash on the base', () => {
    process.env['SUPPORT_ADMIN_URL'] = 'https://admin.example.com/'
    expect(supportThreadAdminUrl('th-1')).toBe('https://admin.example.com/support/th-1')
  })

  it('is null when no admin URL is configured', () => {
    expect(supportThreadAdminUrl('th-1')).toBeNull()
  })
})

describe('supportAlertContent', () => {
  it('names the tenant and subject and links the thread — not the message body', () => {
    process.env['SUPPORT_ADMIN_URL'] = 'https://admin.example.com'
    const out = supportAlertContent(thread)
    expect(out.subject).toBe('[Pegasus support] New thread - Acme Movers')
    expect(out.message).toContain('Invoice totals look wrong')
    expect(out.message).toContain('https://admin.example.com/support/th-1')
  })

  it('says "new message" for a reply on an existing thread', () => {
    expect(supportAlertContent({ ...thread, isNewThread: false }).subject).toBe(
      '[Pegasus support] New message - Acme Movers',
    )
  })

  it('keeps the SNS subject on one line, free of control characters and under 100 characters', () => {
    const out = supportAlertContent({
      ...thread,
      tenantName: `Très\nLong\u0007 ${'x'.repeat(200)}`,
    })
    expect(out.subject.length).toBeLessThan(100)
    // eslint-disable-next-line no-control-regex -- asserting their absence
    expect(out.subject).not.toMatch(/[\u0000-\u001F\u007F]/)
    // UTF-8 is allowed: an accented tenant name survives.
    expect(out.subject).toContain('Très Long')
  })
})

describe('alertOperator', () => {
  it('is a no-op when no topic is configured', async () => {
    const send = vi.fn()
    stub(send)
    expect(await alertOperator(thread)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('publishes to the configured topic', async () => {
    process.env['SUPPORT_ALERT_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:111:pegasus-support-alerts'
    const send = vi.fn().mockResolvedValue({ MessageId: 'm-1' })
    stub(send)
    expect(await alertOperator(thread)).toBe(true)
    const cmd = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(cmd.input['TopicArn']).toBe('arn:aws:sns:us-east-1:111:pegasus-support-alerts')
    expect(cmd.input['Subject']).toBe('[Pegasus support] New thread - Acme Movers')
  })

  it('never throws: a failed publish reports false', async () => {
    process.env['SUPPORT_ALERT_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:111:pegasus-support-alerts'
    stub(vi.fn().mockRejectedValue(new Error('AuthorizationError')))
    expect(await alertOperator(thread)).toBe(false)
  })
})
