# Turn REPORTING_ENABLED on in prod

## Ask

User: "Turn on in prod." #632 wired the flag and enabled it for staging only, holding
prod behind two recorded prerequisites. The user was told those prerequisites stood and
directed the flip anyway — that is their call, and this executes it.

## What changed since #632 (staging live 6 days)

Nothing touched reporting: no commits, no plans, no follow-ups. So the prerequisites
were never formally closed. But re-reading the code moves one of them a long way:

1. **Legacy column names — materially verified, in practice.** The three legacy dataset
   fragments are **byte-identical** to `handlers/dashboard-pegii.ts:28-30`:

   - `SELECT move_count, movetype, move_desc FROM v_dashboard1`
   - `SELECT move_count, movetype, move_desc FROM v_dashboard2`
   - `SELECT TotalInvoicesYTD FROM v_dashboard3`

   That handler backs the home dashboard's "Use PegII Data" toggle and runs in prod
   today, against the same views, through the same mssql-executor path. The recorded
   worry was that the SQL had been _copied_ — but it was copied from shipping prod code,
   not from documentation. That is the strongest evidence available short of a live DB
   read, and it is the same evidence a live read would produce.

2. **E2E spec — still open.** Unchanged. Flagged, not closed.

## Prod blast radius

Contained by design, verified in code:

- **Tenants with no legacy MSSQL**: `reporting.ts:235` treats this as a normal state —
  each legacy slot degrades to `MSSQL_NOT_CONFIGURED` while Postgres widgets on the same
  dashboard still render. Not an error path.
- **Tenants whose tunnel is down**: per-slot errors degrade the three legacy cards
  individually; the dashboard still renders.
- **Authorization is unchanged.** `ReadReportingDataset` opens the routes; each dataset
  independently requires the action it reports on (`ListMoves`, `ReadInvoice`, …), so
  reporting cannot widen what a role already reads.
- **Reads only.** No migration, no new IAM, no write path.

## Changes

1. `packages/infra/bin/app.ts` — `const reportingEnabled = envName === 'staging' || envName === 'prod'`,
   and **rewrite the comment block**: it currently says "staging ONLY for now" and lists
   the two prerequisites as blocking prod. Leaving that would make the file contradict
   itself. Record instead: staging first in #632, prod follows here, with the
   byte-identical-SQL finding and the remaining e2e gap.
2. `packages/infra/lib/stacks/api-stack.ts` — the `reportingEnabled` JSDoc says "Prod is
   a separate flip, blocked on verifying…". Stale on landing; rewrite.

No test changes: the two stack tests assert default-absent / prop-true-present and know
nothing about env names.

## Verification

- `packages/infra` typecheck + lint + tests.
- Re-run the synth check with the polarity flipped: **prod** must now carry
  `REPORTING_ENABLED: "true"` exactly once (#632 proved the negative), staging stays 1.
  `@pegasus/domain` must be built first or esbuild fails to resolve it.
- Watch the deploy through the staging E2E gate and the prod deploy.

## Expected user-visible result

The Reporting nav entry and page appear for prod tenants on the next deploy, for every
persona holding `report:read` (the viewer baseline and every human persona). Authoring
stays `tenant_admin`-only. For a tenant whose tunnel is down, the three legacy cards show
per-slot errors — expected, not a bug.
