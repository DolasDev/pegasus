import { laborAccessFor } from './laborAccess'

const access = (roleNames: string[] | null, driverId: number | null, mappingResolved: boolean) =>
  laborAccessFor({ roleNames, driverId, mappingResolved })

describe('laborAccessFor', () => {
  it('treats the driver role as a driver at once, before /me/driver answers', () => {
    expect(access(['driver'], null, false)).toEqual({
      isDriver: true,
      isOperations: false,
      resolved: true,
      canSeeLabor: true,
      operationsOnly: false,
    })
  })

  it('treats a /me/driver mapping as a driver without the role', () => {
    expect(access(['dispatcher'], 42, true)).toMatchObject({ isDriver: true, canSeeLabor: true })
  })

  it('is operations-only for an Operations role with no driver identity', () => {
    expect(access(['operations_admin'], null, true)).toMatchObject({
      isDriver: false,
      isOperations: true,
      canSeeLabor: true,
      operationsOnly: true,
    })
  })

  it('does not call an Operations user operations-only until the mapping has resolved', () => {
    expect(access(['tenant_admin'], null, false)).toMatchObject({
      isOperations: true,
      resolved: false,
      operationsOnly: false,
    })
  })

  it('keeps Dashboard and Trips for an Operations user who is also a driver', () => {
    expect(access(['tenant_admin', 'driver'], null, false)).toMatchObject({
      isDriver: true,
      isOperations: true,
      operationsOnly: false,
    })
    expect(access(['central_planning_dispatch'], 7, true).operationsOnly).toBe(false)
  })

  it('hides Labor from a user who is neither', () => {
    expect(access(['viewer'], null, true)).toMatchObject({ canSeeLabor: false })
    expect(access(null, null, true)).toMatchObject({ canSeeLabor: false, operationsOnly: false })
  })
})
