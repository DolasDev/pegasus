// ---------------------------------------------------------------------------
// Unit tests for server.ts bootstrap
//
// Mocks @hono/node-server's serve function and verifies that:
//   - The server starts on the configured port/host
//   - Graceful shutdown calls closeAllPools() and db.$disconnect()
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockServe, mockCloseAllPools, mockDbDisconnect } = vi.hoisted(() => ({
  mockServe: vi.fn(() => ({
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
  mockCloseAllPools: vi.fn(async () => {}),
  mockDbDisconnect: vi.fn(async () => {}),
}))

vi.mock('@hono/node-server', () => ({
  serve: mockServe,
}))

vi.mock('../lib/mssql', () => ({
  closeAllPools: mockCloseAllPools,
}))

vi.mock('../db', () => ({
  db: { $disconnect: mockDbDisconnect, $queryRaw: vi.fn() },
}))

vi.mock('../lib/prisma', () => ({
  createTenantDb: vi.fn(() => ({})),
}))

// Mock jose so tenant middleware doesn't fail on import
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  errors: { JWTExpired: class JWTExpired extends Error {} },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('server bootstrap', () => {
  const originalPort = process.env['PORT']
  const originalHost = process.env['HOST']
  const originalDbUrl = process.env['DATABASE_URL']

  beforeEach(() => {
    mockServe.mockClear()
    mockCloseAllPools.mockClear()
    mockDbDisconnect.mockClear()
    process.env['SKIP_AUTH'] = 'true'
    process.env['DATABASE_URL'] =
      process.env['DATABASE_URL'] ?? 'postgresql://test:test@localhost:5432/test'
  })

  afterEach(() => {
    if (originalPort === undefined) delete process.env['PORT']
    else process.env['PORT'] = originalPort
    if (originalHost === undefined) delete process.env['HOST']
    else process.env['HOST'] = originalHost
    if (originalDbUrl === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = originalDbUrl
    delete process.env['SKIP_AUTH']
  })

  it('exports a startServer function that calls serve with the app', async () => {
    const { startServer } = await import('../server')

    process.env['PORT'] = '4000'
    process.env['HOST'] = '127.0.0.1'

    startServer()

    expect(mockServe).toHaveBeenCalledTimes(1)
    expect(mockServe).toHaveBeenCalledWith(
      expect.objectContaining({ port: 4000, hostname: '127.0.0.1' }),
      expect.any(Function),
    )
  })

  it('defaults to port 3000 and host 0.0.0.0 when env vars are not set', async () => {
    delete process.env['PORT']
    delete process.env['HOST']

    const { startServer } = await import('../server')
    startServer()

    expect(mockServe).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000, hostname: '0.0.0.0' }),
      expect.any(Function),
    )
  })

  it('exports a shutdown function that closes pools and disconnects db', async () => {
    const { shutdown } = await import('../server')

    await shutdown()

    expect(mockCloseAllPools).toHaveBeenCalledTimes(1)
    expect(mockDbDisconnect).toHaveBeenCalledTimes(1)
  })
})
