// ---------------------------------------------------------------------------
// Unit tests for the RingCentral api module — verifies each wrapper calls
// apiFetch with the right path/method.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '../api/client'
import {
  listRingCentralConnections,
  disconnectRingCentralConnection,
  startRingCentralConnect,
} from '../api/ringcentral'

const mockApiFetch = vi.mocked(apiFetch)

describe('ringcentral api', () => {
  it('listRingCentralConnections calls GET /api/v1/integrations/ringcentral/connections', async () => {
    mockApiFetch.mockResolvedValueOnce({ connections: [] })
    const result = await listRingCentralConnections()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/ringcentral/connections')
    expect(result).toEqual({ connections: [] })
  })

  it('disconnectRingCentralConnection calls DELETE /api/v1/integrations/ringcentral/connections/:id', async () => {
    mockApiFetch.mockResolvedValueOnce({ disconnected: true })
    const result = await disconnectRingCentralConnection('conn-1')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/integrations/ringcentral/connections/conn-1',
      { method: 'DELETE' },
    )
    expect(result).toEqual({ disconnected: true })
  })

  it('startRingCentralConnect calls GET oauth/start with the URL-encoded number', async () => {
    mockApiFetch.mockResolvedValueOnce({ url: 'https://rc.example/authorize' })
    const result = await startRingCentralConnect('+14155550123')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/integrations/ringcentral/oauth/start?number=%2B14155550123',
    )
    expect(result).toEqual({ url: 'https://rc.example/authorize' })
  })

  it('propagates errors thrown by apiFetch', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'))
    await expect(listRingCentralConnections()).rejects.toThrow('Network error')
  })
})
