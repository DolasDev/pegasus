import { describe, it, expect, vi, beforeEach } from 'vitest'

// withRingCentralToken (401 discard + retry) is tested in client.test.ts; here
// it is a pass-through.
const h = vi.hoisted(() => ({
  withRingCentralToken: vi.fn(),
}))

vi.mock('../client', () => ({
  withRingCentralToken: h.withRingCentralToken,
}))

import { setMessageReadStatus } from '../message-store'
import { RingCentralOAuthError } from '../oauth'

const connection = { id: 'conn-1', tokenSecretArn: 'arn:1' }
const PATH = '/restapi/v1.0/account/~/extension/~/message-store/4455'
let get: ReturnType<typeof vi.fn>
let put: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.withRingCentralToken.mockReset()
  get = vi.fn()
  put = vi.fn()
  const client = { get, put, post: vi.fn(), del: vi.fn() }
  h.withRingCentralToken.mockImplementation(
    (_conn: unknown, call: (c: typeof client, t: unknown) => Promise<unknown>) =>
      call(client, { accessToken: 'at', apiBase: 'https://rc.test' }),
  )
})

describe('setMessageReadStatus', () => {
  it('PUTs readStatus when the message is unread', async () => {
    get.mockResolvedValue({ id: 4455, readStatus: 'Unread' })
    put.mockResolvedValue({ id: 4455, readStatus: 'Read' })
    expect(await setMessageReadStatus(connection, '4455', 'Read')).toEqual({
      readStatus: 'Read',
      changed: true,
    })
    expect(put).toHaveBeenCalledWith(PATH, { readStatus: 'Read' })
    expect(h.withRingCentralToken).toHaveBeenCalledWith(connection, expect.any(Function))
  })

  it('skips the write when already read', async () => {
    get.mockResolvedValue({ id: 4455, readStatus: 'Read' })
    expect(await setMessageReadStatus(connection, '4455', 'Read')).toEqual({
      readStatus: 'Read',
      changed: false,
    })
    expect(put).not.toHaveBeenCalled()
  })

  it('propagates other RingCentral errors', async () => {
    get.mockRejectedValue(new RingCentralOAuthError('RingCentral API 404', 404))
    await expect(setMessageReadStatus(connection, '4455', 'Read')).rejects.toMatchObject({
      status: 404,
    })
  })
})
