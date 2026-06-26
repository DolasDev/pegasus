import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  acquireAccessToken: vi.fn(),
  makeClient: vi.fn(),
  invalidateToken: vi.fn(),
}))

vi.mock('../client', async (importActual) => {
  const actual = await importActual<typeof ClientModule>()
  return {
    ...actual,
    acquireAccessToken: h.acquireAccessToken,
    makeClient: h.makeClient,
    invalidateToken: h.invalidateToken,
  }
})

import { sendSms } from '../sms'
import { RingCentralOAuthError } from '../oauth'
import type * as ClientModule from '../client'

const connection = {
  id: 'conn-1',
  tokenSecretArn: 'arn:1',
  ownerNumber: '+15005550001',
}
const SMS_PATH = '/restapi/v1.0/account/~/extension/~/sms'

let postMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.acquireAccessToken.mockResolvedValue({
    accessToken: 'at',
    apiBase: 'https://platform.ringcentral.com',
  })
  postMock = vi.fn()
  h.makeClient.mockReturnValue({ get: vi.fn(), post: postMock, put: vi.fn(), del: vi.fn() })
})

describe('sendSms', () => {
  it('returns the RC response on the first try (no retry)', async () => {
    postMock.mockResolvedValue({ id: 1, messageStatus: 'Queued' })

    const res = await sendSms(connection, '+15005550006', 'hi')

    expect(res).toEqual({ id: 1, messageStatus: 'Queued' })
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith(SMS_PATH, {
      from: { phoneNumber: '+15005550001' },
      to: [{ phoneNumber: '+15005550006' }],
      text: 'hi',
    })
    expect(h.invalidateToken).not.toHaveBeenCalled()
    expect(h.acquireAccessToken).toHaveBeenCalledTimes(1)
  })

  it('on a 401 TokenInvalid, drops the cached token, re-mints, and retries once', async () => {
    postMock
      .mockRejectedValueOnce(new RingCentralOAuthError('RingCentral API 401: Token not found', 401))
      .mockResolvedValueOnce({ id: 2, messageStatus: 'Queued' })

    const res = await sendSms(connection, '+15005550006', 'hi')

    expect(res).toEqual({ id: 2, messageStatus: 'Queued' })
    expect(h.invalidateToken).toHaveBeenCalledWith('conn-1')
    expect(h.acquireAccessToken).toHaveBeenCalledTimes(2)
    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it('retries at most once — a second 401 propagates', async () => {
    postMock.mockRejectedValue(
      new RingCentralOAuthError('RingCentral API 401: Token not found', 401),
    )

    await expect(sendSms(connection, '+15005550006', 'hi')).rejects.toBeInstanceOf(
      RingCentralOAuthError,
    )
    expect(h.invalidateToken).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry on non-401 errors (e.g. 404)', async () => {
    postMock.mockRejectedValue(new RingCentralOAuthError('RingCentral API 404', 404))

    await expect(sendSms(connection, '+15005550006', 'hi')).rejects.toMatchObject({
      status: 404,
    })
    expect(h.invalidateToken).not.toHaveBeenCalled()
    expect(postMock).toHaveBeenCalledTimes(1)
  })
})
