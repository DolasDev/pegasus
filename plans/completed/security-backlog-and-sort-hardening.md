# Security backlog: dependency alerts + finish the ORDER BY hardening — COMPLETED

> **Closed 2026-09-29.** Every engineering item is done across three PRs. The one remaining
> item, Part 3 (the `DEPENDABOT_AUTOMERGE_PAT` secret), needs the repo owner's credentials
> and was moved to `plans/todo/dependabot-automerge-pat.md` unchanged.
>
> Written 2026-09-28 against `main` @ `f34e3703`. Predecessor: **#736** closed a SQL injection
> in the shipments-list `ORDER BY`; this plan was the residue that PR deliberately scoped out.

## Outcome

| item                                 | PR   | outcome                                       |
| ------------------------------------ | ---- | --------------------------------------------- |
| 2a. anyio (critical + high + medium) | #740 | Re-locked 4.14.0 → **4.15.1**                 |
| 1. activities/trips sort lookup      | #741 | `Object.hasOwn` guard + a second `order` bug  |
| 2b/2c. every npm alert               | #742 | 3 fixed by override, 3 accepted with evidence |

**The alert count was 10, not 9** — `undici` GHSA-3wwx-pv8p-q78v (moderate) landed after the
plan was written, on the very release the existing override floor pinned to.

---

## Part 1 — ORDER BY hardening (#741) — DONE

Both siblings now use the `Object.hasOwn` shape #736 landed in `shipments-list.ts`. Confirmed
by reproducing first: trips-list emitted `ORDER BY function Object() { [native code] } DESC`
and returned 500.

**One thing the plan did not anticipate.** `trips-list` carried a _second_ copy of a bug #736
fixed: the whole query is `JSON.parse(...) as TripQuery` with nothing validating it, so a JSON
number for `sortBy.order` is truthy and threw on `.toUpperCase()`. Guarded with `String(...)`.
`activities-list` was already safe there — it compares `order === 'desc'` rather than calling a
string method.

The copied test needed one departure: `trips-list` has no default ordering (`buildOrderBy`
returns `''` on a miss), so its fallback assertion is "no `ORDER BY` at all".

---

## Part 2 — dependency alerts (#740, #742) — DONE

### Fixed by an override

| package    | before | after      | scope                                                                |
| ---------- | ------ | ---------- | -------------------------------------------------------------------- |
| protobufjs | 7.6.3  | **7.6.6**  | `@grpc/proto-loader` parent — the 8.8.0 copies untouched, as planned |
| qs         | 6.15.1 | **6.16.0** | `typed-rest-client` parent                                           |
| undici     | 7.29.0 | **7.30.0** | floor raised `>=7.29.0` → `>=7.29.1`                                 |
| mysql2     | 3.15.3 | **3.24.4** | `prisma` parent, npm's combined form                                 |

**mysql2 reverses a prior decision.** It had been _allowlisted_ in `audit-ci.jsonc` on the
grounds that prisma pins it exactly, "the same vendor-exact-pin situation as deepmerge-ts".
That comparison does not hold: deepmerge-ts needs a **major** (7 → 8) the vendor pinned
exactly, while mysql2's fix is a **minor within 3.x**. Overridden, and the allowlist entry
removed — an override that removes the vulnerable code beats an accept that reasons around it.

### Accepted, with the evidence in `audit-ci.jsonc`

The plan's Part 2b listed `decode-uri-component` as a straightforward override. **It is not.**
All three of these have a published fix that cannot be installed:

- **decode-uri-component** — 0.5.0 is ESM-only, but both vulnerable copies sit under the CJS
  `query-string@7.1.3`, which does `require('decode-uri-component')`. Probed: that returns
  `{__esModule, default}` and the call site dies with `decodeComponent is not a function`.
  The parent-scoping the plan suggested was also a **no-op** — see the npm-mechanics entry in
  `GOTCHAS.md`.
- **image-size** — the plan was right that 2.0.3 now exists, but `metro@0.83.7` passes a file
  **path string** at `src/Assets.js:177` and 2.x dropped string input. Probed: `TypeError`.
  The existing allowlist rationale ("no patched version exists") was stale and was rewritten.
- **uuid** — reachability settled it, exactly as the plan asked. The advisory needs `v3`/`v5`/
  `v6` **with a `buf` argument**; `exceljs` and `xcode` each call only `v4()` with none. A fix
  would cost three-to-four forced majors for a path neither executes.

Upstream is already moving on two of them, and that is now recorded: `@react-navigation/core@7.23.0`
dropped `query-string` entirely, and `metro@0.87.1` has no `image-size` dependency at all. Both
are gated behind Expo SDK 55 → RN 0.83, not behind the vulnerable packages.

---

## Part 3 — the PAT → `plans/todo/dependabot-automerge-pat.md`

---

## Left open, deliberately

`audit-ci` reports the three **brace-expansion** allowlist entries as unused. That predates this
work — nothing here touches `brace-expansion` or `aws-cdk-lib` — so it was left alone rather than
folded in. If `aws-cdk-lib` has stopped bundling the vulnerable copy, those three entries can go;
verify the bundled version first, because the entries exist precisely because an `overrides` floor
cannot reach a `bundledDependencies` copy.

`scripts/check-overrides.mjs` reports **43 of 49** overrides as "inert" locally. On a set this
carefully curated that is a false signal, not a finding — most likely `npm ls --all --json` under
npm 11 (local) no longer emits the `overridden` flag the script keys on, while CI runs npm 10.8.2.
Worth confirming before anyone acts on one of its monthly reports.
