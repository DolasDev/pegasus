# Fix: RingCentral forwarder starvation by unconfigured / unreachable tenants

**Status:** COMPLETE · **Type:** fix · **Opened + landed:** 2026-09-24

## Problem

`listPendingForwards` drains the 100 globally oldest-due `message_forward_outbox` rows. Rows for a
tenant with no `mssqlConnectionString` are parked (+5 min, no attempt spent) every run and cycle
forever, so they occupy the whole batch and starve configured tenants.

Prod incident 2026-09-24: 1,467 orphaned Dolios rows (from a deleted RingCentral connection, tenant
never had an on-prem connection string) filled every batch; Nelson Westerberg's 254 fresh messages
sat untouched for 50+ minutes, and every new SMS would have lagged ~75 min (one full Dolios cycle).
Mitigated by deleting the Dolios rows by hand; this plan removes the failure mode.

## Fix

1. **Skip unconfigured tenants at the query.** `listPendingForwards` only returns rows whose tenant
   has a non-null, non-empty `mssqlConnectionString`. Those rows stay `PENDING` untouched (no park
   churn) and drain automatically once the tenant is configured. The in-handler "no connection
   string" park stays as a defensive branch.
2. **Per-tenant fairness.** The drain takes up to `limit` due rows **per tenant** (oldest-due first
   within each tenant) rather than `limit` rows globally, so one tenant's backlog can't crowd out
   another's.
3. **Unreachable short-circuit.** Once a tenant's on-prem is unreachable within a run, the forwarder
   parks that tenant's remaining rows in the batch without invoking `mssql-executor` again (no 100
   serial timeouts against a dead tunnel).

## Tests (TDD)

- Repository (integration, `messaging.repository.test.ts`): rows of a tenant with null / empty
  connection string are excluded; per-tenant cap returns rows from every tenant with due rows even
  when one tenant has more than `limit`.
- Forwarder (unit, `lambda-ringcentral-forward.test.ts`): after one unreachable error, the rest of
  that tenant's rows are parked with no further `executeSql` calls, while another tenant's rows in
  the same run are still sent.

## Out of scope

- Requeueing Nelson Westerberg's 642 July `DEAD` rows (separate ops decision).
- Treating "Invalid object name" as unreachable / auto-creating the on-prem table.

## Docs

- `docs/ringcentral-message-capture-runbook.md` — backlog alarm note: rows of unconfigured tenants
  now wait untouched and still count toward `pegasus-rc-outbox-backlog`.
- `dolas/agents/project/GOTCHAS.md` — global oldest-first outbox drain + infinite park = starvation.
