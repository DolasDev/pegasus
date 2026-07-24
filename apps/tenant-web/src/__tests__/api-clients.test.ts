// ---------------------------------------------------------------------------
// Unit tests for api-clients — verifies each wrapper calls apiFetch correctly
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '../api/client'
import {
  getApiClients,
  getApiClient,
  createApiClient,
  updateApiClient,
  revokeApiClient,
  rotateApiClient,
  deleteApiClient,
} from '../api/api-clients'

const mockApiFetch = vi.mocked(apiFetch)

describe('api-clients', () => {
  it('getApiClients calls GET /api/v1/api-clients', async () => {
    mockApiFetch.mockResolvedValueOnce([])
    const result = await getApiClients()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients')
    expect(result).toEqual([])
  })

  it('getApiClient calls GET /api/v1/api-clients/:id', async () => {
    const client = { id: 'c-1', name: 'Test' }
    mockApiFetch.mockResolvedValueOnce(client)
    const result = await getApiClient('c-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients/c-1')
    expect(result).toEqual(client)
  })

  it('createApiClient calls POST /api/v1/api-clients with body', async () => {
    const created = { id: 'c-2', name: 'New', plainKey: 'pk_live_abc' }
    mockApiFetch.mockResolvedValueOnce(created)
    const result = await createApiClient({ name: 'New', roleNames: ['integrations'] })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'New', roleNames: ['integrations'] }),
    })
    expect(result).toEqual(created)
  })

  it('updateApiClient calls PATCH /api/v1/api-clients/:id with body', async () => {
    const updated = { id: 'c-1', name: 'Updated' }
    mockApiFetch.mockResolvedValueOnce(updated)
    const result = await updateApiClient('c-1', { name: 'Updated' })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients/c-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated' }),
    })
    expect(result).toEqual(updated)
  })

  it('updateApiClient sends roleNames in the PATCH body', async () => {
    mockApiFetch.mockResolvedValueOnce({})
    await updateApiClient('c-1', { roleNames: ['reporting'] })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients/c-1', {
      method: 'PATCH',
      body: JSON.stringify({ roleNames: ['reporting'] }),
    })
  })

  it('revokeApiClient calls POST /api/v1/api-clients/:id/revoke', async () => {
    const revoked = { id: 'c-1', revokedAt: '2026-01-01T00:00:00Z' }
    mockApiFetch.mockResolvedValueOnce(revoked)
    const result = await revokeApiClient('c-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients/c-1/revoke', {
      method: 'POST',
    })
    expect(result).toEqual(revoked)
  })

  it('rotateApiClient calls POST /api/v1/api-clients/:id/rotate', async () => {
    const rotated = { id: 'c-1', plainKey: 'pk_live_new' }
    mockApiFetch.mockResolvedValueOnce(rotated)
    const result = await rotateApiClient('c-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients/c-1/rotate', {
      method: 'POST',
    })
    expect(result).toEqual(rotated)
  })

  it('deleteApiClient calls DELETE /api/v1/api-clients/:id', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'c-1', deleted: true })
    const result = await deleteApiClient('c-1')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/api-clients/c-1', {
      method: 'DELETE',
    })
    expect(result).toEqual({ id: 'c-1', deleted: true })
  })

  it('propagates errors thrown by apiFetch', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'))
    await expect(getApiClients()).rejects.toThrow('Network error')
  })
})
