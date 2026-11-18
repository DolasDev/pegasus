import { describe, it, expect, vi, beforeEach } from 'vitest'

// The 401 discard-and-retry policy lives in withRingCentralToken (tested in
// client.test.ts). Here it is a pass-through so these tests pin what sendSms
// sends and that it goes through the shared-token path at all.
const h = vi.hoisted(() => ({
  withRingCentralToken: vi.fn(),
}))

vi.mock('../client', async (importActual) => {
  const actual = await importActual<typeof ClientModule>()
  return { ...actual, withRingCentralToken: h.withRingCentralToken }
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
  h.withRingCentralToken.mockReset()
  postMock = vi.fn()
  const client = { get: vi.fn(), post: postMock, put: vi.fn(), del: vi.fn() }
  h.withRingCentralToken.mockImplementation(
    (_conn: unknown, call: (c: typeof client, t: unknown) => Promise<unknown>) =>
      call(client, { accessToken: 'at', apiBase: 'https://platform.ringcentral.com' }),
  )
})

describe('sendSms', () => {
  it('POSTs from the connection number through the shared-token helper', async () => {
    postMock.mockResolvedValue({ id: 1, messageStatus: 'Queued' })

    const res = await sendSms(connection, '+15005550006', 'hi')

    expect(res).toEqual({ id: 1, messageStatus: 'Queued' })
    expect(h.withRingCentralToken).toHaveBeenCalledWith(connection, expect.any(Function))
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock).toHaveBeenCalledWith(SMS_PATH, {
      from: { phoneNumber: '+15005550001' },
      to: [{ phoneNumber: '+15005550006' }],
      text: 'hi',
    })
  })

  it('propagates RingCentral errors unchanged', async () => {
    postMock.mockRejectedValue(new RingCentralOAuthError('RingCentral API 404', 404))

    await expect(sendSms(connection, '+15005550006', 'hi')).rejects.toMatchObject({
      status: 404,
    })
  })
})
