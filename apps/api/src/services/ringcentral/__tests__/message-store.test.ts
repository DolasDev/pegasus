import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  acquireAccessToken: vi.fn(),
  makeClient: vi.fn(),
  invalidateToken: vi.fn(),
}))

vi.mock('../client', () => ({
  acquireAccessToken: h.acquireAccessToken,
  makeClient: h.makeClient,
  invalidateToken: h.invalidateToken,
}))

import { setMessageReadStatus } from '../message-store'
import { RingCentralOAuthError } from '../oauth'

const connection = { id: 'conn-1', tokenSecretArn: 'arn:1' }
const PATH = '/restapi/v1.0/account/~/extension/~/message-store/4455'
let get: ReturnType<typeof vi.fn>
let put: ReturnType<typeof vi.fn>

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  get = vi.fn()
  put = vi.fn()
  h.acquireAccessToken.mockResolvedValue({ accessToken: 'at', apiBase: 'https://rc.test' })
  h.makeClient.mockReturnValue({ get, put, post: vi.fn(), del: vi.fn() })
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
  })

  it('skips the write when already read', async () => {
    get.mockResolvedValue({ id: 4455, readStatus: 'Read' })
    expect(await setMessageReadStatus(connection, '4455', 'Read')).toEqual({
      readStatus: 'Read',
      changed: false,
    })
    expect(put).not.toHaveBeenCalled()
  })

  it('re-mints the token once on a 401', async () => {
    get
      .mockRejectedValueOnce(new RingCentralOAuthError('RingCentral API 401', 401))
      .mockResolvedValueOnce({ readStatus: 'Unread' })
    put.mockResolvedValue({ readStatus: 'Read' })
    await setMessageReadStatus(connection, '4455', 'Read')
    expect(h.invalidateToken).toHaveBeenCalledWith('conn-1')
    expect(h.acquireAccessToken).toHaveBeenCalledTimes(2)
  })

  it('propagates other RingCentral errors', async () => {
    get.mockRejectedValue(new RingCentralOAuthError('RingCentral API 404', 404))
    await expect(setMessageReadStatus(connection, '4455', 'Read')).rejects.toMatchObject({
      status: 404,
    })
  })
})
