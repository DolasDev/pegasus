# Security backlog: dependency alerts + finish the ORDER BY hardening

> **Resume point.** Written 2026-09-28 against `main` @ `f34e3703`. Everything below
> was verified live at that commit — re-verify version numbers before acting, because
> alert floors move (see the recurrence note in
> `dolas/agents/project/GOTCHAS.md` on advisory timing).
>
> Predecessor: **#736** closed a SQL injection in the shipments-list `ORDER BY`
> (merged + deployed). This plan is the residue that PR deliberately scoped out,
> plus the dependency alerts that accumulated during the Dependabot backlog work.

---

## Part 1 — Finish the ORDER BY hardening (small, do first)

#736 whitelisted `sortBy.value` in `shipments-list.ts` and, while doing so, found a
second-order bug: **a plain object literal inherits from `Object.prototype`, so a bare
`MAP[value]` lookup returns a truthy _function_ for `constructor`, `toString`,
`valueOf`, `hasOwnProperty`.** Those sail past an `if (col)` guard.

This is **not** arbitrary injection — the interpolated text is a fixed function source,
not attacker content — so it is a whitelist bypass and a guaranteed 500, not a data
breach. That is why it was left as a follow-up rather than folded into the security fix.

Two handlers still have the bare-index form:

| file                                                      | line | current                                |
| --------------------------------------------------------- | ---- | -------------------------------------- |
| `apps/api/src/handlers/longhaul-cloud/activities-list.ts` | 255  | `SORTABLE_COLUMNS[query.sortBy.value]` |
| `apps/api/src/handlers/longhaul-cloud/trips-list.ts`      | 279  | `SORTABLE_COLUMNS[sortBy.value]`       |

**Their column whitelists are correct** — only the lookup needs hardening. Copy the
shape #736 landed in `shipments-list.ts`:

```ts
const requested = query.sortBy?.value
const sortCol =
  typeof requested === 'string' && Object.hasOwn(SORTABLE_COLUMNS, requested)
    ? SORTABLE_COLUMNS[requested]
    : undefined
```

Test to copy: the `rejects inherited Object.prototype keys as sort columns` case in
`apps/api/src/handlers/longhaul-cloud/shipments-list.test.ts` — loops
`constructor`/`toString`/`valueOf`/`hasOwnProperty`, asserts 200 (not 500), asserts the
default ordering, and asserts `'native code'` never reaches the SQL.

**Already swept, do not re-do:** every other interpolated `ORDER BY` in `apps/api` is
safe — `shipment-filters.ts` hardcodes `f.name ASC`, and `reference-data.ts:126`
interpolates `client.moveTypesWhere`, which is server-side tenant config, not caller
input. No other caller-controlled `ORDER BY` exists.

---

## Part 2 — Dependency alerts

Nine open alerts at `f34e3703`. **They are not one task** — the tractable ones are
overrides, two need judgment, and one is genuinely unfixable-by-bump.

### 2a. anyio — CRITICAL, do this first

- **Where:** `packages/workflows-sdk-python/uv.lock`, currently **4.14.0**; fix is **4.14.2**
- Python, so this is a `uv.lock` change, not npm. #686 added a re-lock guard — read it
  before editing, and re-lock rather than hand-editing the hashes.
- Three alerts (critical/high/medium) collapse onto this one bump.

### 2b. Straightforward npm overrides

This repo's established remedy is a root `overrides` entry with a matching
`//overrides` comment explaining _why_ (read a few existing entries first — they are
the house style, and several document traps worth knowing).

**GOTCHA that applies to every one of these** (bit #644, #647, #513): editing
`overrides` alone does nothing — npm caches the old resolution and
`packages[""].overrides` in the lock stays `null`. You must delete the affected
`*/node_modules/<pkg>` keys from `package-lock.json`, then re-resolve.

| package                  | resolved now         | fix      | shape of the change                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **protobufjs**           | root `7.6.3`         | `7.6.5`  | **Parent-scope it**, do NOT add a tree-wide entry. `@temporalio/{common,proto}` are correctly on nested `8.8.0`; only `@grpc/proto-loader`'s 7.x copy is vulnerable. A tree-wide `<8` ceiling is exactly what broke #661 for weeks. Use `"@grpc/proto-loader": { "protobufjs": ">=7.6.5 <8" }`.                                                               |
| **qs** (dev)             | `6.15.1`             | `6.15.2` | `typed-rest-client` pins `6.15.1` exactly, so Dependabot reports `security_update_not_possible` and can never fix it — an override is the only route. Reachable only via `@stryker-mutator/*` (mutation testing), so dev-scope.                                                                                                                               |
| **decode-uri-component** | root already `0.5.0` | `0.5.0`  | Root is **already patched**. The vulnerable `0.2.2` copies are nested under `@react-navigation/core` and `expo-router` — the _same two parents_ the existing `nanoid` override already parent-scopes. Add `decode-uri-component` alongside those entries; read the `nanoid` comment first, it explains why parent-scoping beats a version-scoped `pkg@2` key. |
| **mysql2** (dev)         | `3.15.3`             | `3.22.0` | HIGH but dev-scope. Check whether a plain bump works before reaching for an override.                                                                                                                                                                                                                                                                         |

### 2c. Needs a judgment call — do not just force these

**uuid** — root is already patched at `11.1.1`. The vulnerable copies are
`exceljs → uuid@8.3.2` and `xcode → uuid@7.0.3`. Forcing `>=11.1.1` drags both across
**two majors** on packages that did not ask for it, which is precisely the kind of
forced major CLAUDE.md's dependency rule warns against. Establish reachability first —
is the vulnerable code path even called from `exceljs`/`xcode` usage here? — then
decide between override, upstream bump, or documented accept.

**image-size** — was previously `fix: NONE` and is now **fixable at `2.0.3`** (from
`1.2.1`). That is a major bump; check what pulls it (transitive, Expo-adjacent) and
whether the consumer tolerates 2.x.

---

## Part 3 — The one thing engineering cannot do

**Set the `DEPENDABOT_AUTOMERGE_PAT` repository secret.** Needs the repo owner's
credentials.

Why it matters: #633 fixed Dependabot auto-merge (an auto-merge request enabled while a
PR is still red is never re-evaluated under a merge queue). The `enqueue` job now works
— PRs reach the queue on their own. But a **bot-initiated** enqueue does not trigger
`merge_group` checks, because GITHUB_TOKEN actions do not trigger workflows
(community discussion #70310). Reproduced four times: #645, then #656/#387/#657 — each
self-queued, sat in `AWAITING_CHECKS` with zero `merge_group` runs, and started CI
instantly when dequeued and re-enqueued under a human token.

The workflow already reads
`secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN`, so this is a **secrets
change, no code change**. Until it exists, every Dependabot PR needs a manual nudge:

```
gh api graphql -f query='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{position}}}' -F id="$(gh pr view <N> --json id -q .id)"
gh pr merge <N> --auto
```

---

## Suggested order

1. **anyio** (critical, isolated, Python-only)
2. **Part 1** sibling hardening (two one-line changes + a copied test)
3. **protobufjs + qs + decode-uri-component** — one PR, all three are parent-scoped
   overrides sharing the same lock-key gotcha
4. **mysql2** (try a plain bump first)
5. **uuid + image-size** — only after reachability is established
6. **The PAT** — independent of all of the above; ask the owner any time

## Verification for each

`turbo typecheck lint test` green. For override work also confirm the resolution
actually moved (`npm ls <pkg>` or a lockfile read) — an override that silently did not
apply is the single most common failure mode in this repo's dependency history, and it
looks identical to success until CI or an alert says otherwise.

Do **not** commit `apps/api/vitest.config.ts` coverage-floor drift: `autoUpdate` only
raises floors, and raised floors invite the merge-queue ejection this repo has already
hit. Same for `apps/e2e/.env.test` (worktree DB port) and `uv.lock` churn unrelated to
the bump.
