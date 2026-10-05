// ---------------------------------------------------------------------------
// Company membership sync — which pegII employee is each cloud user, in one
// company? (cloud identity I3; plans/todo/cloud-identity-and-companies.md,
// "Membership & attribution sync").
//
// `planMembershipSync` is pure: given the company's salesman directory, the
// tenant's (non-service, not deactivated) users and the company's existing
// memberships, it decides every write. The repository applies the plan.
//
// Matching, per user:
//   1. email (trimmed, case-insensitive), then
//   2. TenantUser.legacyWindowsUsername ↔ salesman.win_username — the same key
//      the desktop and the longhaul proxy already use.
// The first stage with a usable (active, not terminated) employee decides. One
// usable match → LINKED; several → ambiguous. With no usable match, a single
// inactive/terminated match is recorded INACTIVE, so the admin view shows
// "matched, but terminated" instead of "unmatched".
//
// Ambiguity is never resolved by guessing, in either direction: a user matching
// several employees, or an employee matched by several users, links nobody and
// is reported. Attribution is never an access decision (D-I1), but a wrong
// `created_by` on a legacy row is still wrong — so no link beats a guessed one.
//
// Rows are never deleted. A previously LINKED user who no longer resolves to a
// usable employee (terminated, ambiguous, gone from the directory, or no longer
// matching) becomes INACTIVE. Users outside the input (service accounts,
// deactivated users) are left untouched.
// ---------------------------------------------------------------------------

export interface DirectoryEmployee {
  code: number
  email: string | null
  winUsername: string | null
  active: boolean
  /** ISO date (yyyy-mm-dd…) or null. */
  dateTerminated: string | null
}

export interface SyncUser {
  id: string
  email: string
  legacyWindowsUsername: string | null
}

export interface ExistingMembership {
  tenantUserId: string
  employeeCode: number
  status: 'LINKED' | 'INACTIVE'
}

export type MatchedBy = 'EMAIL' | 'WIN_USERNAME'

export interface MembershipWrite {
  tenantUserId: string
  employeeCode: number
  legacyWindowsUsername: string | null
  status: 'LINKED' | 'INACTIVE'
  matchedBy: MatchedBy
}

export interface AmbiguousMatch {
  /** `user` = one user matched several employees; `employee` = several users matched one employee. */
  kind: 'user' | 'employee'
  tenantUserIds: string[]
  employeeCodes: number[]
}

export interface MembershipSyncPlan {
  /**
   * Users whose existing LINKED row stops being LINKED to the same employee.
   * Applied FIRST (flip to INACTIVE), so the one-LINKED-user-per-employee index
   * never sees two users on one employee mid-sync — even when two users swap.
   */
  releaseUserIds: string[]
  /** Upserts keyed by (company, user), applied after the release. */
  writes: MembershipWrite[]
  unmatchedUserIds: string[]
  ambiguous: AmbiguousMatch[]
  /** LINKED after the sync. */
  linked: number
  /** LINKED now that weren't LINKED to the same employee before. */
  newlyLinked: number
  /** LINKED before, not LINKED to the same employee now. */
  deactivated: number
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

function isUsable(e: DirectoryEmployee, today: string): boolean {
  if (!e.active) return false
  // A termination date on or before today wins over a stale active flag.
  return !e.dateTerminated || e.dateTerminated.slice(0, 10) > today
}

type Proposal =
  | { kind: 'link' | 'inactive'; employee: DirectoryEmployee; matchedBy: MatchedBy }
  | { kind: 'ambiguous'; codes: number[] }
  | { kind: 'none' }

export function planMembershipSync(input: {
  directory: DirectoryEmployee[]
  users: SyncUser[]
  existing: ExistingMembership[]
  now: Date
}): MembershipSyncPlan {
  const today = input.now.toISOString().slice(0, 10)
  const byEmail = new Map<string, DirectoryEmployee[]>()
  const byWun = new Map<string, DirectoryEmployee[]>()
  for (const e of input.directory) {
    for (const [index, key] of [
      [byEmail, norm(e.email)],
      [byWun, norm(e.winUsername)],
    ] as const) {
      if (!key) continue
      index.set(key, [...(index.get(key) ?? []), e])
    }
  }

  const proposals = new Map<string, Proposal>()
  for (const user of input.users) {
    const stages: Array<[MatchedBy, DirectoryEmployee[]]> = [
      ['EMAIL', norm(user.email) ? (byEmail.get(norm(user.email)) ?? []) : []],
      [
        'WIN_USERNAME',
        norm(user.legacyWindowsUsername) ? (byWun.get(norm(user.legacyWindowsUsername)) ?? []) : [],
      ],
    ]
    let proposal: Proposal = { kind: 'none' }
    for (const [matchedBy, matches] of stages) {
      const usable = matches.filter((e) => isUsable(e, today))
      if (usable.length === 1) {
        proposal = { kind: 'link', employee: usable[0]!, matchedBy }
        break
      }
      if (usable.length > 1) {
        proposal = { kind: 'ambiguous', codes: usable.map((e) => e.code) }
        break
      }
    }
    if (proposal.kind === 'none') {
      // No usable employee in any stage: remember a single terminated one.
      const terminated = stages.find(([, matches]) => matches.length > 0)
      if (terminated && terminated[1].length === 1) {
        proposal = { kind: 'inactive', employee: terminated[1][0]!, matchedBy: terminated[0] }
      } else if (terminated) {
        proposal = { kind: 'ambiguous', codes: terminated[1].map((e) => e.code) }
      }
    }
    proposals.set(user.id, proposal)
  }

  const ambiguous: AmbiguousMatch[] = []
  for (const [userId, p] of proposals) {
    if (p.kind === 'ambiguous') {
      ambiguous.push({ kind: 'user', tenantUserIds: [userId], employeeCodes: p.codes })
    }
  }

  // Employee side: one employee proposed for several users links none of them.
  const claimants = new Map<number, string[]>()
  for (const [userId, p] of proposals) {
    if (p.kind === 'link') {
      claimants.set(p.employee.code, [...(claimants.get(p.employee.code) ?? []), userId])
    }
  }
  for (const [code, userIds] of claimants) {
    if (userIds.length < 2) continue
    ambiguous.push({ kind: 'employee', tenantUserIds: userIds, employeeCodes: [code] })
    for (const id of userIds) proposals.set(id, { kind: 'ambiguous', codes: [code] })
  }

  const existingByUser = new Map(input.existing.map((m) => [m.tenantUserId, m]))
  const writes: MembershipWrite[] = []
  const releaseUserIds: string[] = []
  const unmatchedUserIds: string[] = []
  let newlyLinked = 0
  let deactivated = 0

  for (const user of input.users) {
    const p = proposals.get(user.id)!
    const before = existingByUser.get(user.id)
    const wasLinkedTo = before?.status === 'LINKED' ? before.employeeCode : null

    if (p.kind === 'link' || p.kind === 'inactive') {
      const status = p.kind === 'link' ? 'LINKED' : 'INACTIVE'
      writes.push({
        tenantUserId: user.id,
        employeeCode: p.employee.code,
        legacyWindowsUsername: p.employee.winUsername?.trim() || null,
        status,
        matchedBy: p.matchedBy,
      })
      if (status === 'LINKED' && wasLinkedTo !== p.employee.code) newlyLinked++
      if (wasLinkedTo !== null && (status !== 'LINKED' || wasLinkedTo !== p.employee.code)) {
        releaseUserIds.push(user.id)
        deactivated++
      }
      continue
    }

    if (wasLinkedTo !== null) {
      releaseUserIds.push(user.id)
      deactivated++
    }
    if (p.kind === 'none') unmatchedUserIds.push(user.id)
  }

  const linked = writes.filter((w) => w.status === 'LINKED').length
  return { releaseUserIds, writes, unmatchedUserIds, ambiguous, linked, newlyLinked, deactivated }
}
