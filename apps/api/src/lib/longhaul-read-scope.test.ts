import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import {
  OPERATIONS_ROLES,
  hasOperationsRole,
  orderScopeForIds,
  resolveLonghaulReadScope,
  resolveOrderReadScope,
  scopeForDriverId,
  type LonghaulReadScope,
  type OrderReadScope,
} from './longhaul-read-scope'

async function scopeFor(opts: {
  roleNames: string[]
  userId?: string | null
  longhaulDriverId?: number | null
}): Promise<{ scope: LonghaulReadScope; findUnique: ReturnType<typeof vi.fn> }> {
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      opts.longhaulDriverId === undefined ? null : { longhaulDriverId: opts.longhaulDriverId },
    )
  let scope: LonghaulReadScope | undefined
  const app = new Hono<AppEnv>()
  app.get('/', async (c) => {
    c.set('principal', {
      sub: 'sub-1',
      tenantId: 'tenant-1',
      roleNames: opts.roleNames,
    } as AppEnv['Variables']['principal'])
    if (opts.userId !== null) c.set('userId', opts.userId ?? 'user-1')
    c.set('db', { tenantUser: { findUnique } } as unknown as PrismaClient)
    scope = await resolveLonghaulReadScope(c)
    return c.text('ok')
  })
  await app.request('/')
  return { scope: scope!, findUnique }
}

describe('longhaul read scope', () => {
  it.each(OPERATIONS_ROLES)('%s reads everything, without a DB lookup', async (role) => {
    const { scope, findUnique } = await scopeFor({ roleNames: [role], longhaulDriverId: 4766 })
    expect(scope).toEqual({ kind: 'all' })
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('a driver who also holds an Operations role is an Operations user', async () => {
    const { scope } = await scopeFor({
      roleNames: ['driver', 'operations_admin'],
      longhaulDriverId: 4766,
    })
    expect(scope).toEqual({ kind: 'all' })
  })

  it('a driver is scoped to their own longhaulDriverId', async () => {
    const { scope, findUnique } = await scopeFor({ roleNames: ['driver'], longhaulDriverId: 4766 })
    expect(scope).toEqual({ kind: 'driver', driverId: 4766 })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { longhaulDriverId: true },
    })
  })

  it('any non-Operations role is scoped too (fail closed), not only `driver`', async () => {
    expect((await scopeFor({ roleNames: ['viewer'], longhaulDriverId: 12 })).scope).toEqual({
      kind: 'driver',
      driverId: 12,
    })
    expect((await scopeFor({ roleNames: [] })).scope).toEqual({ kind: 'none' })
  })

  it('no mapping, a placeholder driver 0, or no TenantUser reads nothing', async () => {
    expect((await scopeFor({ roleNames: ['driver'], longhaulDriverId: null })).scope).toEqual({
      kind: 'none',
    })
    expect((await scopeFor({ roleNames: ['driver'], longhaulDriverId: 0 })).scope).toEqual({
      kind: 'none',
    })
    const noUser = await scopeFor({ roleNames: ['driver'], userId: null, longhaulDriverId: 4766 })
    expect(noUser.scope).toEqual({ kind: 'none' })
    expect(noUser.findUnique).not.toHaveBeenCalled()
  })

  it('helpers', () => {
    expect(hasOperationsRole(['driver'])).toBe(false)
    expect(hasOperationsRole(['driver', 'tenant_admin'])).toBe(true)
    expect(scopeForDriverId(undefined)).toEqual({ kind: 'none' })
    expect(scopeForDriverId(7)).toEqual({ kind: 'driver', driverId: 7 })
  })
})

describe('order read scope', () => {
  async function orderScopeFor(opts: {
    roleNames: string[]
    userId?: string | null
    user?: { longhaulDriverId: number | null; localDriverEmployeeId: number | null } | null
  }): Promise<{ scope: OrderReadScope; findUnique: ReturnType<typeof vi.fn> }> {
    const findUnique = vi.fn().mockResolvedValue(opts.user ?? null)
    let scope: OrderReadScope | undefined
    const app = new Hono<AppEnv>()
    app.get('/', async (c) => {
      c.set('principal', {
        sub: 'sub-1',
        tenantId: 'tenant-1',
        roleNames: opts.roleNames,
      } as AppEnv['Variables']['principal'])
      if (opts.userId !== null) c.set('userId', opts.userId ?? 'user-1')
      c.set('db', { tenantUser: { findUnique } } as unknown as PrismaClient)
      scope = await resolveOrderReadScope(c)
      return c.text('ok')
    })
    await app.request('/')
    return { scope: scope!, findUnique }
  }

  it.each(OPERATIONS_ROLES)('%s reads every order, without a DB lookup', async (role) => {
    const { scope, findUnique } = await orderScopeFor({ roleNames: [role] })
    expect(scope).toEqual({ kind: 'all' })
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('carries both ids, each in its own field', async () => {
    const { scope, findUnique } = await orderScopeFor({
      roleNames: ['driver'],
      user: { longhaulDriverId: 4766, localDriverEmployeeId: 3097 },
    })
    expect(scope).toEqual({ kind: 'driver', longhaulDriverId: 4766, localDriverEmployeeId: 3097 })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { longhaulDriverId: true, localDriverEmployeeId: true },
    })
  })

  it('a local-only driver is a driver here (but stays `none` on the trip reads)', async () => {
    const user = { longhaulDriverId: null, localDriverEmployeeId: 3097 }
    expect((await orderScopeFor({ roleNames: ['driver'], user })).scope).toEqual({
      kind: 'driver',
      longhaulDriverId: null,
      localDriverEmployeeId: 3097,
    })
    expect(
      (await scopeFor({ roleNames: ['driver'], longhaulDriverId: user.longhaulDriverId })).scope,
    ).toEqual({ kind: 'none' })
  })

  it('no ids, placeholder 0s, no TenantUser row or no user id read nothing', async () => {
    const none = { kind: 'none' }
    const user = { longhaulDriverId: null, localDriverEmployeeId: null }
    expect((await orderScopeFor({ roleNames: ['driver'], user })).scope).toEqual(none)
    expect(
      (
        await orderScopeFor({
          roleNames: ['driver'],
          user: { longhaulDriverId: 0, localDriverEmployeeId: 0 },
        })
      ).scope,
    ).toEqual(none)
    expect((await orderScopeFor({ roleNames: ['driver'], user: null })).scope).toEqual(none)
    const noUser = await orderScopeFor({ roleNames: ['driver'], userId: null })
    expect(noUser.scope).toEqual(none)
    expect(noUser.findUnique).not.toHaveBeenCalled()
  })

  it('a 0 in one space never grants that space', () => {
    expect(orderScopeForIds(0, 3097)).toEqual({
      kind: 'driver',
      longhaulDriverId: null,
      localDriverEmployeeId: 3097,
    })
    expect(orderScopeForIds(4766, 0)).toEqual({
      kind: 'driver',
      longhaulDriverId: 4766,
      localDriverEmployeeId: null,
    })
  })
})
