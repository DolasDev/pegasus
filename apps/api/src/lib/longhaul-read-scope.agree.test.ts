import { describe, expect, it } from 'vitest'
// The API does not depend on @pegasus/auth (adding a workspace dep touches the
// CDK bundling path), so read the shared list by path: the copies must agree.
import { OPERATIONS_ROLES as SHARED } from '../../../../packages/auth/src/roles'
import { OPERATIONS_ROLES } from './longhaul-read-scope'

describe('OPERATIONS_ROLES', () => {
  it('matches the @pegasus/auth list tenant-web and mobile gate on', () => {
    expect([...OPERATIONS_ROLES].sort()).toEqual([...SHARED].sort())
  })
})
