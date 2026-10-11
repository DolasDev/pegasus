/**
 * Conformance — **[A8 §9 item 11]**: the standing columns take holder KINDS, and the four entries
 * the item owned are closed.
 *
 * The item's asymmetry: `authoritative` took {@link AuthoritativeHolder} precisely so it could name
 * a party [A8 §2]'s cast cannot enumerate, while `corroborating` / `competing` / `advisory` took
 * `RoleName[]` and nothing else — so a standing that depends on the fact was written into the row's
 * `note` as **prose**. Prose is not gated, which is why three of the item's four entries sat there
 * for five releases.
 *
 * **This file gates the closure, and the TENSE is the point.** A closed entry legitimately *names*
 * the item that closed it, so a gate that merely greps `item 11` would fire on its own fix — that
 * is the defect the party round found when it swept a phrase instead of an item. The gate below
 * asks whether anything is still **owed to** the item, which in `authority-table.json`'s own
 * convention is an `owedTo` citing it that does not open with "Not owed".
 *
 * The type-level half is `standing-holder-refuses.ts`.
 */
import { describe, expect, it } from 'vitest'

import { AUTHORITY_TABLE, listedStandingOf, standingAfterBoundary } from '../../src/rules/authority'
import type { AuthorityTableEntry, StandingHolder } from '../../src/rules/authority'
import type { AssertionType } from '../../src/vocabulary'
import { ROLE_NAMES } from '../../src/envelope'
import { loadAuthorityTable } from '../../src/index'

import authorityTable from '../../data/authority-table.json'

/**
 * The three standing columns of every ROWED row, read through the declared type.
 *
 * The literal type of each row omits the columns it does not carry (they are optional), so a walk
 * over `Object.entries(AUTHORITY_TABLE)` cannot reach them on the union — the same cast
 * `src/rules/authority.ts`'s own rules use, for the same reason.
 */
function standingColumnsOf(
  type: AssertionType,
): readonly [string, readonly StandingHolder[] | undefined][] {
  const table: Readonly<Record<AssertionType, AuthorityTableEntry>> = AUTHORITY_TABLE
  const row = table[type]
  if (!('a8Row' in row)) return []
  return [
    ['corroborating', row.corroborating],
    ['competing', row.competing],
    ['advisory', row.advisory],
  ]
}

/* ------------------------------------------------------------------------------------------------
 * Half 1 — the four entries [A8 §9 item 11] owned
 * ---------------------------------------------------------------------------------------------- */

describe('[A8 §9 item 11] the four owed entries are closed, each in the column that owns it', () => {
  it('row 10 `identity` lists the echo as a corroborating standing, not as a sentence', () => {
    // Was: `corroborating` ABSENT, with "Corroboration is `the counterparty echoing the value back`
    // — a relation, not a role, so it is not listed as one" in the row's `note`.
    expect(AUTHORITY_TABLE.identity.corroborating).toEqual([{ kind: 'schemeCounterparty' }])
  })

  it('row 17 `documentIssuance` lists the SAME member — one relation at two grains', () => {
    // [A8 §5] row 17's own cell: "which is row 10's echo one aggregate over".
    expect(AUTHORITY_TABLE.documentIssuance.corroborating).toEqual([{ kind: 'schemeCounterparty' }])
    // AND equal to row 10's, which is the claim the §5 cell actually makes.
    //
    // **Both lines, because the equality ALONE gates co-drift rather than drift.** Changing row
    // 10's cell to a role and row 17's with it leaves the two still equal, so this assertion would
    // pass a table in which the echo had been deleted from both rows at once. The literal above is
    // what makes the pair wrong instead of merely consistent; the equality below is what makes
    // them one relation instead of two that happen to agree today.
    expect(AUTHORITY_TABLE.documentIssuance.corroborating).toEqual(
      AUTHORITY_TABLE.identity.corroborating,
    )
  })

  it('row 11 `charge` competes on quantum through the kind its own PROPOSED aspect holds', () => {
    // The kind was never missing — only a column that could hold it. Asserted against the
    // authoritative cell rather than against a literal, because that identity IS the finding:
    // the proposing party and the party competing on quantum are the same designation.
    const { authoritative } = AUTHORITY_TABLE.charge
    expect(authoritative.kind).toBe('perQualifierAspect')
    if (authoritative.kind !== 'perQualifierAspect') throw new Error('unreachable')
    expect(AUTHORITY_TABLE.charge.competing).toEqual([authoritative.by.PROPOSED])
    expect(authoritative.by.PROPOSED).toEqual({ kind: 'performingRole' })
  })

  it('leaves nothing in the shipped table still OWED to item 11', () => {
    const stillOwed: string[] = []

    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) {
        node.forEach((child, index) => walk(child, `${at}[${index}]`))
        return
      }
      if (node === null || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      const owedTo = record['owedTo']
      if (
        'designation' in record &&
        typeof owedTo === 'string' &&
        owedTo.includes('item 11') &&
        !owedTo.startsWith('Not owed')
      ) {
        stillOwed.push(at)
      }
      for (const [key, value] of Object.entries(record)) walk(value, `${at}.${key}`)
    }

    walk(authorityTable, 'authority-table')
    expect(stillOwed, `still owed to [A8 §9 item 11]: ${stillOwed.join(', ')}`).toEqual([])
  })

  it('keeps all four designations PRESENT — closing an entry does not delete it', () => {
    // [A8 §9 item 11] is closed in the TYPED module; `authority-table.json` has no holder-kind
    // representation at all, so every resolved non-role holder in it stays an `unresolved`
    // designation carrying "Not owed —". Deleting these four would make the file claim the
    // standings are empty, which is the one thing [A8 §4.1] note 1 forbids reading into a column.
    const designations = new Set<string>()
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (node === null || typeof node !== 'object') return
      const record = node as Record<string, unknown>
      const designation = record['designation']
      if (typeof designation === 'string') designations.add(designation)
      Object.values(record).forEach(walk)
    }
    walk(authorityTable)

    for (const designation of [
      'the counterparty echoing the value back',
      'the party the instrument is issued TO, echoing its number back',
      'the performing role',
      'the performing role, on quantum',
    ]) {
      expect(designations.has(designation), `${designation} was deleted rather than closed`).toBe(
        true,
      )
    }
  })
})

/* ------------------------------------------------------------------------------------------------
 * Half 2 — widening the column did not demote anybody
 * ---------------------------------------------------------------------------------------------- */

describe('[A8 §4.1] note 1 survives the widening — unplaced is not demoted', () => {
  it('answers `undefined` for every role on a column that holds ONLY kinds', () => {
    // Row 10's `corroborating` holds one member and it is not a role. Before item 11 the column was
    // absent, and `listedStandingOf` answered `undefined`; it must still answer `undefined` rather
    // than reading a kind as a match for whichever role is asked about.
    for (const role of ROLE_NAMES) {
      expect(listedStandingOf('identity', role), `identity/${role}`).toBeUndefined()
    }
  })

  it('does not read `performingRole` on `charge`.competing as any role competing', () => {
    // `standingAfterBoundary` falls back to 'advisory', so a kind leaking through as a match would
    // silently PROMOTE every role to competing on this row.
    for (const role of ROLE_NAMES) {
      expect(standingAfterBoundary('charge', role), `charge/${role}`).toBe('advisory')
    }
  })

  it('still places the roles that were placed before — `weight.gross` is the control', () => {
    expect(listedStandingOf('weight.gross', 'weighMaster')).toBe('corroborating')
    expect(listedStandingOf('weight.gross', 'goodsOwner')).toBe('competing')
    expect(listedStandingOf('weight.gross', 'booker')).toBe('advisory')
    expect(listedStandingOf('weight.gross', 'driver')).toBeUndefined()
  })
})

/* ------------------------------------------------------------------------------------------------
 * Half 3 — every role cell is still a role, and the two representations still agree
 * ---------------------------------------------------------------------------------------------- */

describe('[A8 §9 item 11] the widened columns admit exactly what they should', () => {
  const roleNames = new Set<string>(ROLE_NAMES)

  it('puts nothing but [A8 §2] roles in a `{kind: "role"}` member', () => {
    // `vocabulary.test.ts` holds the JSON side of this; the typed table was previously held by the
    // element type alone, and widening the element type is what took that guarantee away.
    const cells: { at: string; role: string }[] = []
    for (const type of Object.keys(AUTHORITY_TABLE) as AssertionType[]) {
      for (const [column, holders] of standingColumnsOf(type)) {
        for (const holder of holders ?? []) {
          if (holder.kind === 'role') cells.push({ at: `${type}.${column}`, role: holder.role })
        }
      }
    }
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells) {
      expect(roleNames.has(cell.role), `${cell.at} holds the non-role ${cell.role}`).toBe(true)
    }
  })

  it('names every non-role member it uses, so a new kind cannot arrive unremarked', () => {
    // Enumerated, never counted — [A1 §9]. Exactly two non-role designations are in use across the
    // three columns, and both are [A8 §9 item 11]'s. A third arriving without a round is the
    // failure this catches.
    const kinds = new Set<string>()
    for (const type of Object.keys(AUTHORITY_TABLE) as AssertionType[]) {
      for (const [, holders] of standingColumnsOf(type)) {
        for (const holder of holders ?? []) if (holder.kind !== 'role') kinds.add(holder.kind)
      }
    }
    expect([...kinds].sort()).toEqual(['performingRole', 'schemeCounterparty'])
  })

  it('loads the shipped JSON table unchanged — the four rewrites are prose, not shape', () => {
    // The `owedTo` rewrite touched four strings. If it had touched the shape, the loader is where
    // that shows up, and this round deliberately changed no shape on the JSON side.
    const loaded = loadAuthorityTable(authorityTable)
    expect(loaded.rows.size).toBeGreaterThan(0)
    const identity = loaded.byType.get('identity')
    expect(identity?.standings.corroborating.unresolved.map((entry) => entry.designation)).toEqual([
      'the counterparty echoing the value back',
    ])
    expect(
      identity?.standings.corroborating.unresolved.every((entry) =>
        entry.owedTo.startsWith('Not owed'),
      ),
    ).toBe(true)
  })
})
