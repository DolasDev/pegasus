/**
 * Conformance — the shapes **[A8 §9 item 11]**'s closure must keep illegal.
 *
 * Same contract as `party-grain-refuses.ts`, `role-class-refuses.ts`, `identity-scheme-refuses.ts`
 * and the rest: every `@ts-expect-error` must fire. If an illegal state ever becomes legal,
 * TypeScript reports the directive as unused (`TS2578`) and this file stops compiling.
 *
 * **The decisions themselves are held in `src/rules/authority.ts`**, as three `Exact<>`-style gates
 * with their assignments beside them ([A5 §9]): `EveryAuthoritativeHolderIsAStandingHolder`,
 * `TheEchoIsNotAnAuthoritativeHolder` and `StandingHolderKindsAreExactlyThese`.
 *
 * **What this file holds is the edge those cannot see.** They compare types to types; the
 * regression that actually threatens item 11's closure is a **cell**, written the old way —
 * `corroborating: ['weighMaster']` — because that is how every one of the table's 48 standing cells
 * read until this round, it is what five releases of muscle memory will reach for, and a bare
 * string sliding back in is how the asymmetry returns one column at a time.
 *
 * A type-level suite: nothing here runs. The behavioural half is `standing-holders.test.ts`.
 */
import type { AuthoritativeHolder, StandingHolder } from '../../src/rules/authority'

/* ------------------------------------------------------------------------------------------------
 * Half 1 — a standing cell is holders, never bare role names
 * ---------------------------------------------------------------------------------------------- */

/**
 * Named first and assigned second, on `identity-scheme-refuses.ts`'s reason: `@ts-expect-error`
 * covers **one** line, so the spelling has to be somewhere the directive is not.
 *
 * `weighMaster` rather than an invented name on purpose — it is a **real** member of `ROLE_NAMES`
 * and the actual former contents of `weight.gross`'s `corroborating` cell, so what is refused here
 * is unambiguously the **shape** and not the name. A refusal that could be read as "that role does
 * not exist" would send the next reader to [A8 §2].
 */
const theOldCellForm = ['weighMaster'] as const

// @ts-expect-error [A8 §9 item 11] — a standing column takes `StandingHolder`, so a role is
// `{kind: 'role', role}`. The bare-name form is what made `corroborating` unable to hold "the
// counterparty echoing the value back", which then lived in the row's `note` as prose for five
// releases. Write `standingRoles('weighMaster')`.
const bareNamesAreNotStandings: readonly StandingHolder[] = theOldCellForm
void bareNamesAreNotStandings

/**
 * The single-value form, refused separately. `Array<RoleName>` and a one-element tuple fail for the
 * same reason, but a reader who hits only the tuple case can conclude the rule is about tuples.
 */
const oneBareName = 'goodsOwner'

// @ts-expect-error [A8 §9 item 11] — not even one. There is no implicit coercion from a role name
// to the `{kind: 'role'}` member, by design: the constructor `standingRoles` is the only widening
// path, so every cell that holds roles says so at the point it is written.
const oneBareNameIsNotAStanding: readonly StandingHolder[] = [oneBareName]
void oneBareNameIsNotAStanding

/* ------------------------------------------------------------------------------------------------
 * Half 2 — the echo member is a STANDING holder and not an authoritative one
 * ---------------------------------------------------------------------------------------------- */

/**
 * `TheEchoIsNotAnAuthoritativeHolder` in `authority.ts` watches the **type**. This watches the
 * **value**, which is the half a row author hits: the regression is not someone editing the union,
 * it is someone writing `authoritative: {kind: 'held', primary: {kind: 'schemeCounterparty'}}` on
 * row 10 because the echo is the only other party the row mentions.
 *
 * [A8 §5] rows 10 and 17 are `boundBy = SCHEME` and their authority **never moves** — the issuer's,
 * "and nobody else". The echo is a corroboration; promoting it would also publish a member on
 * `$defs/AuthoritativeHolder` that no wire position can hold.
 */
const theEcho = { kind: 'schemeCounterparty' } as const

// @ts-expect-error [A8 §9 item 11] — the echo corroborates and can never be selected. Authority on
// rows 10 and 17 is `schemeIssuer`, and [A6 §3.2(b)] is why row 17 inherits rather than re-argues
// it; a second holder here would be a second rule, and there is not one.
const echoIsNotAuthoritative: AuthoritativeHolder = theEcho
void echoIsNotAuthoritative

/**
 * The converse is **legal and deliberately not refused**: every authoritative holder is a legal
 * standing holder, which is `EveryAuthoritativeHolderIsAStandingHolder`. Asserted here as a
 * compiling assignment rather than left implicit, so that narrowing `StandingHolder` breaks a line
 * a reader can find from this file as well as from the gate.
 */
const custodyHolderIsALegalStanding: StandingHolder = { kind: 'custodyHolder' }
void custodyHolderIsALegalStanding

/* ------------------------------------------------------------------------------------------------
 * Half 3 — the kinds that would undo the distinction item 11 turns on
 * ---------------------------------------------------------------------------------------------- */

/**
 * [A8 §9 item 2] sorted its ten `owedTo` entries into **relations** (which item 11 then closed) and
 * **complements** (which [A8 §4.1] note 1 already licensed, and which became notes). Conflating
 * those two is, in that round's words, "how four relations and two complements spent five releases
 * filed as one item's vocabulary problem".
 *
 * A member for a complement is the way that conflation comes back, so the two spellings the
 * surviving complements would arrive under are refused by name. They are not owed and not refused
 * on evidence — **they need nothing**, which is the one disposition a backlog cannot express.
 */
const theNonInspectingParties = 'nonInspectingParties'
const everyoneElse = 'everyoneElse'

// @ts-expect-error [A8 §9 item 11] — row 8's corroborating "the non-inspecting parties" is a
// COMPLEMENT: its extension changes per fact, so a member spelled this way would be a role nobody
// holds. [A8 §4.1] note 1 makes an unlisted role "unplaced, not demoted" — the column was never
// exhaustive, and saying so is not a debt.
const noComplementKind: StandingHolder['kind'] = theNonInspectingParties
void noComplementKind

// @ts-expect-error [A8 §9 item 11] — row 9's advisory "everyone else", the same refusal from the
// other column. Both became notes at [A8 §9 item 2]; neither is item 11's and neither is owed.
const noEveryoneElseKind: StandingHolder['kind'] = everyoneElse
void noEveryoneElseKind

/**
 * And the one that is genuinely **owed**, kept apart from the two above because the dispositions
 * differ and a reader who cannot tell them apart will re-attempt the wrong one.
 *
 * "The tariff owner" is a missing **name** — `ROLE_NAMES` has no van-line member — so it is carried
 * as `{kind: 'owedRole', owedRole: owed('tariffOwner', …)}` on `charge`'s `RATED` aspect, with a
 * payload naming what owes it. It is owed to [A8 §9 item 2] and blocked on `secondary` grade, and
 * it is **not** item 11's: a bare kind for it would assert that no name would do, which is exactly
 * what distinguishes `performingRole` from it one aspect over.
 */
const theTariffOwner = 'tariffOwner'

// @ts-expect-error [A8 §9 item 2], not item 11 — a missing role NAME is `owedRole` carrying an
// `Owed<>`, never a bare kind. The payload is the whole difference: it names the document that owes
// the name, so the gap stays countable instead of reading as a relation no vocabulary could close.
const owedNameIsNotABareKind: StandingHolder['kind'] = theTariffOwner
void owedNameIsNotABareKind
