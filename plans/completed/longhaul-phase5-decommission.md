# Longhaul Phase 5 — decommission the on-prem proxy

_Created 2026-05-27. Gated on Phase 4 (writes, complete — see
`plans/completed/longhaul-phase4-writes.md`) and on the jump-to-order browser-direct
change (commit `638b356`). Related: `plans/todo/jump-to-order-desktop-handoff.md`._

## Goal

All longhaul reads (Phase 3) and writes (Phase 4) are cloud-direct via the in-VPC
`mssql-executor`, and jump-to-order is moving browser-direct. The cloud no longer
proxies _anything_ to the tenant on-prem server. Remove the dead proxy path and the
on-prem longhaul server code.

## Gating preconditions (all must hold before starting)

1. ✅ Phase 3 + 4 complete — every `/onprem/longhaul/*` route has an explicit
   cloud-direct handler registered **before** the wildcard (`app.ts:243–341`).
2. ⏳ jump-to-order web change (`638b356`) deployed + verified — it's the last consumer
   of the proxy fallback. (The cloud no longer needs the proxy regardless; the old UI
   stub never called it either.)
3. ⏳ Confirm no other caller hits `/api/v1/onprem/longhaul/*` without a cloud-direct
   route — grep CloudWatch `onprem proxy forward` logs for ~1 week post-deploy; expect zero.

## ✅ Safe to remove

| Target                                                                                                    | Why                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/api/src/handlers/onprem.ts`                                                                         | The `/longhaul/*` HTTP proxy. Nothing falls through once jump-to-order is browser-direct. |
| `v1.route('/onprem', onpremHandler)` (`app.ts:345`) + import                                              | The wildcard fallback mount.                                                              |
| `apps/api/src/handlers/longhaul/` (all, incl. `remote.ts`)                                                | The on-prem server's Hono handlers. Cloud-direct handlers bypass them entirely.           |
| `apps/api/src/repositories/longhaul/*`                                                                    | knex repositories used only by the on-prem handlers.                                      |
| `apps/api/src/lib/longhaul-db.ts`                                                                         | knex MSSQL connection for the on-prem server.                                             |
| On-prem longhaul mount in `app.server.ts` (`onprem.route('/longhaul', longhaulRouter)`, line 45) + import | On-prem server no longer needs the longhaul router.                                       |

## ⚠️ Must STAY (corrects the earlier "remove everything" assumption)

| Keep                                                                                       | Reason                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/tunnel-client.ts` (`tunnelFetch`) + WireGuard tunnel/VPC infra                        | The **cloud-direct** MSSQL path (`lib/mssql-executor-client.ts`) tunnels into the VPC to reach the executor Lambda. Removing the tunnel breaks every migrated read/write.                                                          |
| `lib/mssql-executor-client.ts`, `apps/mssql-executor/**`, all `handlers/longhaul-cloud/**` | The cloud-direct implementation.                                                                                                                                                                                                   |
| The `/onprem/longhaul/*` **route paths** (explicit GET/POST/… registrations)               | The SPA still calls these URLs. Only the _wildcard fallback_ is removed; the explicit handlers keep serving. (Renaming `/onprem/longhaul/*` → `/longhaul/*` is an optional later cleanup needing SPA coordination — out of scope.) |
| `handlers/admin/vpn-diagnose.ts`                                                           | Independent admin tool that uses `tunnelFetch`.                                                                                                                                                                                    |

## 🔧 Requires surgery, not deletion

1. **`middleware/longhaul-user.ts`** — shared. Imported by `lib/longhaul-cloud-user.ts`
   and cloud handlers (`version`, `users-me`, `shipment-filters*`) **and** the on-prem
   `handlers/longhaul/index.ts` + `m2m-app-auth.ts`. Remove only the on-prem middleware
   mount; **extract/retain** what the cloud side imports (likely the legacy-user types +
   the salesman-lookup helper). Verify each cloud import still resolves afterward.
2. **`lib/longhaul-shipment-enrich.ts`** — imports `type { Knex } from 'knex'` and is used
   by **cloud** handlers (`shipments-list.ts`, `shipments-write.ts`, `activities-write.ts`)
   as well as on-prem `handlers/longhaul/shipments.ts`. Before knex can be uninstalled,
   drop the `Knex` type here (a param type only relevant to the on-prem caller) — replace
   with a local interface or remove the param.
3. **`knex` package removal** — only after: (a) `repositories/longhaul/*` + `longhaul-db.ts`
   deleted, (b) `shipment-enrich` `Knex` type removed, (c) `types.onprem.ts` and
   `app.server.ts` knex references cleaned. Then `npm uninstall knex`; confirm `tsc`
   across the api package is clean.

## Suggested unit ordering (each its own commit, gated by `tsc` + `test`)

1. Remove the `/onprem` wildcard mount + `handlers/onprem.ts` (after confirming zero
   proxy-forward logs). Smallest, highest-signal change.
2. Refactor `longhaul-shipment-enrich.ts` to drop the `Knex` type; split `longhaul-user.ts`
   into shared-vs-on-prem.
3. Delete `handlers/longhaul/` + `repositories/longhaul/` + the on-prem mount in `app.server.ts`.
4. Delete `longhaul-db.ts`; uninstall `knex`; clean `types.onprem.ts`.
5. Decommission the WireGuard/on-prem-server infra **only if** pegii/efwk are also fully
   migrated — **out of scope here**; the longhaul decommission does not by itself retire
   the tunnel (cloud-direct still needs it).

## Verification

- `cd apps/api && npx tsc --noEmit && npx vitest run` green after each unit.
- Full `e2e-qa-longhaul` run green (proves the cloud-direct routes still serve after the
  proxy is gone).
- CloudWatch: zero `onprem proxy forward` entries for longhaul over the observation window.

## ✅ Results (2026-05-28 — branch `longhaul-phase5-decommission`)

Executed in three gated commits, each `tsc --noEmit` + `vitest run` green:

1. **`da76ae9`** — removed the `/onprem` wildcard proxy: deleted `handlers/onprem.ts`
   (+test) and its `v1.route('/onprem', onpremHandler)` mount in `app.ts`. The explicit
   `/onprem/longhaul/*` route registrations stay (the SPA still calls those URLs).
2. **`848d5b0`** — deleted the on-prem longhaul server code: `handlers/longhaul/` (incl.
   `remote.ts`), `repositories/longhaul/`, `middleware/longhaul-user.ts`, `lib/longhaul-db.ts`,
   the `app.server.ts` mount, and the `closeAllLonghaulPools` shutdown wiring in `server.ts`.
   Shared-file surgery: dropped the knex-typed `loadActivityTypesMap` from
   `lib/longhaul-shipment-enrich.ts` and the `longhaulDb`/`longhaulUser` vars + `Knex` import
   from `types.onprem.ts` (pegii/efwk keep `mssqlPool`). **`middleware/longhaul-user.ts`
   turned out to be deletable, not surgery** — it was code-imported only by the deleted
   on-prem router; every other reference was a comment.
3. **`8936700`** — `npm uninstall knex -w apps/api`; lockfile updated.

Verification grep (`from.*handlers/longhaul[^-]`, `repositories/longhaul`, `longhaul-db`,
`middleware/longhaul-user`, `from 'knex'`) returns **no imports**. Full monorepo
`npm run typecheck` green (13/13); `apps/api` `vitest` green (96 files / 1154 tests).

**Out of scope, as planned & still live:** WireGuard tunnel + VPC infra, `lib/tunnel-client.ts`,
`lib/mssql-executor-client.ts`, `apps/mssql-executor/**`, all `handlers/longhaul-cloud/**`,
and `handlers/admin/vpn-diagnose.ts` — the cloud-direct MSSQL path still tunnels into the VPC.

Pending before merge to `main`: the gating CloudWatch observation (zero `onprem proxy forward`
longhaul entries) was assumed passed per the execution request; confirm before merge since a
push to `main` auto-deploys.
