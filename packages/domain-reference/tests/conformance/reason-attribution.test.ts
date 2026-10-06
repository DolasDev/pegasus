/**
 * Conformance — [SD §2.4] rule 6's attribution, and **A8-NO-PARTY**.
 *
 * Two subjects, and they are opposite halves of one decision taken at [A8 §9 item 2]: `roleClass`
 * is refused on the evidence of `src:stedi-x12-reference` element 98, and `ATTRIBUTION_NO_PARTY` is
 * published anyway because it is declared by `Attribution`'s **shape** and is not a class of party.
 *
 * The type-level half is `role-class-refuses.ts`. Everything here **enumerates rather than counts**
 * ([A1 §9]): the codes that forbid a no-party attribution are named, in `src/` and in `data/`, and
 * the two lists are compared in both directions — so a `partyRequired` flipping in the table fails
 * by naming the code that moved.
 */
import { describe, expect, it } from 'vitest'

import {
  ATTRIBUTION_NO_PARTY,
  attributionIsLegalFor,
  CODES_THAT_FORBID_NO_PARTY_ATTRIBUTION,
  loadReasonVocabulary,
  roleClass,
  type RoleClassStaysOwed,
} from '../../src/index'

import reasons from '../../data/reasons.json'

const vocabulary = loadReasonVocabulary(reasons)

describe('[A8 §9 item 2] `roleClass` is refused, and the refusal is a type', () => {
  it('the gate evaluates to `true`, so `RoleClass` is still the owed code', () => {
    // If a later round narrows `RoleClass` to a union of published members, `Exact<>` becomes
    // `never`, the assignment in `rules/authority.ts` stops compiling, and this line stops
    // type-checking too. Asserted here as well so the claim is visible to a reader of the suite —
    // the gate itself is the assignment, per [A5 §9].
    const stillOwed: RoleClassStaysOwed = true
    expect(stillOwed).toBe(true)
  })

  it('an arbitrary class is still constructible, which is what "not closed" means', () => {
    // Element 98 supplies no class axis, so a class nobody publishes is unknown, not illegal —
    // [A9 §3.2]'s shape, reached by a different argument.
    expect(roleClass('a.class.no.source.names')).toBe('a.class.no.source.names')
    // And the three [SD §2.6] illustrates with are illustrations, not members: each is accepted
    // exactly as any other string is, which is the honest state of the vocabulary.
    expect([roleClass('customer'), roleClass('carrier'), roleClass('unknown')]).toEqual([
      'customer',
      'carrier',
      'unknown',
    ])
  })

  it('the no-party spelling cannot be smuggled in through the constructor, in any casing', () => {
    // The casing is folded because the vocabulary's eventual spelling is [A8 §9 item 2]'s to choose:
    // a round that picks lower-case `no_party` must not be able to collide with the shape's member.
    for (const spelling of ['NO_PARTY', 'no_party', 'No_Party']) {
      expect(() => roleClass(spelling)).toThrow(RangeError)
    }
    // A near miss that is NOT the member, so the guard is narrow rather than a prefix match.
    expect(roleClass('NO_PARTY_KNOWN')).toBe('NO_PARTY_KNOWN')
  })
})

describe('A8-NO-PARTY — the codes that may not be attributed to nobody', () => {
  it('names exactly the codes `data/reasons.json` marks `partyRequired`, both directions', () => {
    // The two declarations are independent: `src/rules/authority.ts` writes the names out from
    // [SD §2.4] rule 6's reading, and the table carries a boolean per code. Neither is computed
    // from the other, so this comparison can fail.
    const fromTable = vocabulary.codes
      .filter((entry) => entry.partyRequired)
      .map((entry) => entry.code)
      .sort()
    expect(fromTable).toEqual([...CODES_THAT_FORBID_NO_PARTY_ATTRIBUTION].sort())
  })

  it('refuses a no-party attribution on every one of them, by name', () => {
    for (const code of CODES_THAT_FORBID_NO_PARTY_ATTRIBUTION) {
      expect(
        attributionIsLegalFor(code, ATTRIBUTION_NO_PARTY),
        `${code} requires a party and must not be attributable to nobody`,
      ).toBe(false)
    }
  })

  it('permits it on the two codes that require it, and on the one that is open', () => {
    // `FORCE_MAJEURE` and `DEADLINE_LAPSED` are why the branch exists — [A1 §3.6] and
    // `src:dtr-part-iv` §C.4.b. `CAUSE_UNKNOWN` is permitted and **undecided**: its own docstring
    // records three candidate readings and declines to pick, so the rule must not pre-empt it.
    for (const code of ['FORCE_MAJEURE', 'DEADLINE_LAPSED', 'CAUSE_UNKNOWN']) {
      expect(attributionIsLegalFor(code, ATTRIBUTION_NO_PARTY), code).toBe(true)
    }
  })

  it('says nothing about an ordinary class, on any code', () => {
    // The rule is about one value, not about attribution generally: a `PARTY_ABSENT` attributed to
    // the customer is the [SD §2.6] scenario and must stay legal.
    expect(attributionIsLegalFor('PARTY_ABSENT', 'customer')).toBe(true)
    expect(attributionIsLegalFor('FORCE_MAJEURE', 'unknown')).toBe(true)
  })

  it('the `partyRequired` set and the `PARTY`-scope set COINCIDE today, and that is gated', () => {
    // Measured, not assumed — and the draft of this file assumed the other way round, asserting
    // that `INSTRUCTED_CHANGE` was `partyRequired` at a non-`PARTY` scope and so proved the two
    // axes come apart. It is `PARTY`-scoped, and the two sets are identical.
    //
    // The rule still reads the CODE list rather than `scope`, because `data/reasons.json` declares
    // the discipline per code — its note says `partyRequired` is "optional BY DEFAULT, refined per
    // code" — so the coincidence is a property of the current vocabulary and not a rule. This
    // assertion is what makes that claim falsifiable: the day a code is `partyRequired` at another
    // scope, or a `PARTY`-scope code is added without the flag, it fails **naming the code that
    // moved** rather than silently making `attributionIsLegalFor` disagree with a reader who
    // reimplemented it over `scope`.
    const partyRequired = vocabulary.codes
      .filter((entry) => entry.partyRequired)
      .map((entry) => entry.code)
      .sort()
    const partyScoped = vocabulary.codes
      .filter((entry) => entry.scope === 'PARTY')
      .map((entry) => entry.code)
      .sort()
    expect(partyRequired).toEqual(partyScoped)
  })
})
