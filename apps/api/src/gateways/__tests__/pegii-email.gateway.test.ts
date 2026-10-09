import { describe, it, expect, vi } from 'vitest'
import { createPegiiEmailGateway } from '../pegii-email.gateway'
import type { PegiiApiClient } from '../../lib/pegii-api-client'
import { PegiiApiError } from '../../lib/pegii-api-client'

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
  it('requires the auth + email capabilities, then posts the snake_case wire body', async () => {
    const c = client()
    const requireCapabilities = vi.fn().mockResolvedValue(undefined)
    await createPegiiEmailGateway({ baseUrl: 'http://x', client: c, requireCapabilities }).send(
      EMAIL,
    )
    expect(requireCapabilities).toHaveBeenCalledWith('http://x', [
      'pegii.auth.v1',
      'pegii.email.v1',
    ])
    expect(c.post).toHaveBeenCalledWith('/api/v1/pegii/email/send', {
      to: ['a@nwmovers.test'],
      cc: [],
      subject: 's',
      body: 'b',
      body_type: 'html',
    })
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
