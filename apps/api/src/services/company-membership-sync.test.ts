import { describe, it, expect } from 'vitest'
import {
  planMembershipSync,
  type DirectoryEmployee,
  type ExistingMembership,
  type SyncUser,
} from './company-membership-sync'

const NOW = new Date('2026-10-05T12:00:00Z')

const emp = (code: number, over: Partial<DirectoryEmployee> = {}): DirectoryEmployee => ({
  code,
  email: null,
  winUsername: null,
  active: true,
  dateTerminated: null,
  ...over,
})
const user = (id: string, email: string, wun: string | null = null): SyncUser => ({
  id,
  email,
  legacyWindowsUsername: wun,
})
const plan = (
  directory: DirectoryEmployee[],
  users: SyncUser[],
  existing: ExistingMembership[] = [],
) => planMembershipSync({ directory, users, existing, now: NOW })

describe('planMembershipSync', () => {
  it('links by email, trimmed and case-insensitive, carrying the win_username', () => {
    const p = plan(
      [emp(1001, { email: ' Jane.Doe@NW.com ', winUsername: ' jdoe ' })],
      [user('u1', 'jane.doe@nw.com')],
    )

    expect(p.writes).toEqual([
      {
        tenantUserId: 'u1',
        employeeCode: 1001,
        legacyWindowsUsername: 'jdoe',
        status: 'LINKED',
        matchedBy: 'EMAIL',
      },
    ])
    expect(p).toMatchObject({ linked: 1, newlyLinked: 1, deactivated: 0, unmatchedUserIds: [] })
  })

  it('falls back to the Windows username when no employee has the email', () => {
    const p = plan(
      [emp(7, { email: 'other@nw.com', winUsername: 'BSMITH' })],
      [user('u1', 'bob@nw.com', 'bsmith')],
    )

    expect(p.writes[0]).toMatchObject({
      employeeCode: 7,
      status: 'LINKED',
      matchedBy: 'WIN_USERNAME',
    })
  })

  it('prefers a usable Windows-username match over a terminated email match (rehire)', () => {
    const p = plan(
      [
        emp(1, { email: 'bob@nw.com', active: false, dateTerminated: '2024-01-31' }),
        emp(2, { email: 'bob.new@nw.com', winUsername: 'bsmith' }),
      ],
      [user('u1', 'bob@nw.com', 'bsmith')],
    )

    expect(p.writes[0]).toMatchObject({
      employeeCode: 2,
      status: 'LINKED',
      matchedBy: 'WIN_USERNAME',
    })
  })

  it('records a single terminated match as INACTIVE, not unmatched', () => {
    const p = plan(
      [emp(5, { email: 'gone@nw.com', active: false, dateTerminated: '2026-09-30' })],
      [user('u1', 'gone@nw.com')],
    )

    expect(p.writes).toEqual([expect.objectContaining({ employeeCode: 5, status: 'INACTIVE' })])
    expect(p.unmatchedUserIds).toEqual([])
    expect(p.linked).toBe(0)
  })

  it('treats a past termination date as terminated even when the active flag is stale', () => {
    const p = plan(
      [emp(5, { email: 'gone@nw.com', active: true, dateTerminated: '2026-10-05' })],
      [user('u1', 'gone@nw.com')],
    )

    expect(p.writes[0]).toMatchObject({ status: 'INACTIVE' })
  })

  it('a user matching several usable employees links nothing and is reported', () => {
    const p = plan(
      [emp(1, { email: 'dup@nw.com' }), emp(2, { email: 'dup@nw.com' })],
      [user('u1', 'dup@nw.com')],
    )

    expect(p.writes).toEqual([])
    expect(p.ambiguous).toEqual([{ kind: 'user', tenantUserIds: ['u1'], employeeCodes: [1, 2] }])
    expect(p.unmatchedUserIds).toEqual([])
  })

  it('an employee matched by several users links none of them and is reported', () => {
    const p = plan(
      [emp(9, { email: 'shared@nw.com', winUsername: 'shared' })],
      [user('u1', 'shared@nw.com'), user('u2', 'u2@nw.com', 'shared')],
    )

    expect(p.writes).toEqual([])
    expect(p.ambiguous).toEqual([
      { kind: 'employee', tenantUserIds: ['u1', 'u2'], employeeCodes: [9] },
    ])
  })

  it('reports users with no match at all as unmatched', () => {
    const p = plan([emp(1, { email: 'a@nw.com' })], [user('u1', 'nobody@nw.com')])

    expect(p.unmatchedUserIds).toEqual(['u1'])
    expect(p.writes).toEqual([])
  })

  it('re-running against unchanged data is idempotent: same writes, nothing newly linked', () => {
    const directory = [emp(1001, { email: 'jane@nw.com' })]
    const p = plan(
      directory,
      [user('u1', 'jane@nw.com')],
      [{ tenantUserId: 'u1', employeeCode: 1001, status: 'LINKED' }],
    )

    expect(p.writes).toHaveLength(1)
    expect(p).toMatchObject({ linked: 1, newlyLinked: 0, deactivated: 0, releaseUserIds: [] })
  })

  it('deactivates a previously LINKED user whose employee left the directory', () => {
    const p = plan(
      [],
      [user('u1', 'jane@nw.com')],
      [{ tenantUserId: 'u1', employeeCode: 1001, status: 'LINKED' }],
    )

    expect(p.releaseUserIds).toEqual(['u1'])
    expect(p.deactivated).toBe(1)
    expect(p.unmatchedUserIds).toEqual(['u1'])
  })

  it('deactivates a LINKED user who became ambiguous rather than keeping a stale link', () => {
    const p = plan(
      [emp(1, { email: 'jane@nw.com' }), emp(2, { email: 'jane@nw.com' })],
      [user('u1', 'jane@nw.com')],
      [{ tenantUserId: 'u1', employeeCode: 1, status: 'LINKED' }],
    )

    expect(p.releaseUserIds).toEqual(['u1'])
    expect(p.writes).toEqual([])
  })

  it('releases both sides when two users swap employees, so the partial index never collides', () => {
    const p = plan(
      [emp(1, { email: 'b@nw.com' }), emp(2, { email: 'a@nw.com' })],
      [user('a', 'a@nw.com'), user('b', 'b@nw.com')],
      [
        { tenantUserId: 'a', employeeCode: 1, status: 'LINKED' },
        { tenantUserId: 'b', employeeCode: 2, status: 'LINKED' },
      ],
    )

    expect(p.releaseUserIds.sort()).toEqual(['a', 'b'])
    expect(p.writes.map((w) => [w.tenantUserId, w.employeeCode])).toEqual([
      ['a', 2],
      ['b', 1],
    ])
    expect(p).toMatchObject({ linked: 2, newlyLinked: 2, deactivated: 2 })
  })

  it('a user with an empty email and no Windows username never matches a blank directory row', () => {
    const p = plan([emp(1, { email: '', winUsername: '' })], [user('u1', '')])

    expect(p.unmatchedUserIds).toEqual(['u1'])
  })
})
