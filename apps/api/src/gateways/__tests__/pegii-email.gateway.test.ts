import { describe, it, expect, vi } from 'vitest'
import { createPegiiEmailGateway } from '../pegii-email.gateway'
import type { PegiiApiClient } from '../../lib/pegii-api-client'
import { PegiiApiError } from '../../lib/pegii-api-client'
import type { PegiiCaller } from '../../lib/pegii-request-context'

function client(): PegiiApiClient & { post: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(),
    getHealth: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    post: vi.fn().mockResolvedValue({ sent: true }),
  }
}

const EMAIL = {
  to: ['a@nwmovers.test'],
  cc: [],
  subject: 's',
  body: 'b',
  bodyType: 'html' as const,
}

describe('createPegiiEmailGateway', () => {
  it('requires the cloud-auth + email capabilities, then posts the snake_case wire body', async () => {
    const c = client()
    const requireCapabilities = vi.fn().mockResolvedValue(undefined)
    await createPegiiEmailGateway({ baseUrl: 'http://x', client: c, requireCapabilities }).send(
      EMAIL,
    )
    expect(requireCapabilities).toHaveBeenCalledWith(
      'http://x',
      ['pegii.cloud-auth.v1', 'pegii.email.v1'],
      {},
    )
    expect(c.post).toHaveBeenCalledWith('/api/v1/pegii/email/send', {
      to: ['a@nwmovers.test'],
      cc: [],
      subject: 's',
      body: 'b',
      body_type: 'html',
    })
  })

  it('forwards the caller correlation id to the capability probe', async () => {
    const c = client()
    const requireCapabilities = vi.fn().mockResolvedValue(undefined)
    const caller: PegiiCaller = {
      tenantId: 't',
      correlationId: 'cloud-req-9',
      principal: { tenantUserId: 'svc-1', isServiceAccount: true },
      site: { id: 'site-1', cloudAuthEnabled: true },
      company: { id: 'co-1', code: 'NW', dataSourceKey: null, systemEmployeeCode: 1001 },
    }
    await createPegiiEmailGateway({
      baseUrl: 'http://x',
      client: c,
      caller,
      requireCapabilities,
    }).send(EMAIL)
    expect(requireCapabilities).toHaveBeenCalledWith(
      'http://x',
      ['pegii.cloud-auth.v1', 'pegii.email.v1'],
      { correlationId: 'cloud-req-9' },
    )
  })

  it('never posts to a site that lacks the capabilities', async () => {
    const c = client()
    const requireCapabilities = vi
      .fn()
      .mockRejectedValue(new PegiiApiError('PEGII_API_CAPABILITY_MISSING', 'missing'))
    await expect(
      createPegiiEmailGateway({ baseUrl: 'http://x', client: c, requireCapabilities }).send(EMAIL),
    ).rejects.toMatchObject({ code: 'PEGII_API_CAPABILITY_MISSING' })
    expect(c.post).not.toHaveBeenCalled()
  })
})
