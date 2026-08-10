# sdk-feedback 0038 — outbound plane resolves config-only integrations per request

**Source:** `~/repos/pegasus-workflows/sdk-feedback/0038-registry-overlay-never-refreshed-outside-publish.md`
(Status: Proposed, **blocking** — Weichert delivery 404s ~2 runs in 3.)

## Problem

`call_external` / `deliver_to_external` gate on the **synchronous**
`getIntegrationDefinition(id)`, which reads a module-level `overlay` map that is
only ever populated by `refreshRegistryOverlay(db)` — whose sole non-test callers
are the four config mutation handlers (publish / fork / rollback / delete).

On horizontally-scaled Lambda, a publish warms the overlay on **one** container.
Every other container has `overlay === undefined`, so a config-only integration
(no built-in `REGISTRY` entry — exactly what sdk-feedback 0020 enabled) falls
through to `REGISTRY[id]` → `undefined` → `404 Unknown integration`. Which
container the load balancer picks decides whether the call works.

The validate / map plane is unaffected because it resolves per request against
the DB via `resolveIntegrationDefinition`. That asymmetry is the whole bug.

## Approach

Take the feedback item's **second** proposed shape — make both planes agree by
construction, rather than adding a `loadRegistryOverlayIfStale` call each future
handler must remember (the current split is a footgun: `getIntegrationDefinition`
looks total but is only correct after an unrelated call).

Both outbound handlers use the definition **only** as an existence gate, so the
swap is clean:

```ts
const tenantId = c.get('tenantId')
const def = await resolveIntegrationDefinition(basePrisma, integrationId, tenantId)
if (!def) return c.json({ error: `Unknown integration '${integrationId}'`, code: 'NOT_FOUND' }, 404)
```

`resolveIntegrationDefinition` reads `findActiveForScope` (tenant's own row →
GLOBAL row → built-in) fresh per request, warms the overlay on the platform-scoped
(null-tenant) path, and fails open to the built-in baseline on any DB error.

Use `basePrisma` (the unscoped client, as `validate.ts` does) — GLOBAL rows carry
no `tenantId`, so the request-scoped client could filter them out.

Side benefit this closes: the outbound plane currently ignores **TENANT**-scoped
configs entirely. After the swap a tenant's own published config resolves too.

## Steps

1. `apps/api/src/handlers/integration-call.ts` — hoist `tenantId` above the gate,
   swap the lookup, import `{ db as basePrisma }`.
2. `apps/api/src/handlers/integration-delivery.ts` — same.
3. Update the three suites that `vi.mock` the registry module and export only
   `getIntegrationDefinition` (`integration-call.test.ts`,
   `integration-delivery.test.ts`, `integration-call-blobs.test.ts`) — otherwise
   the new import is `undefined` under the mock.
4. Regression guard (criterion 6): both outbound handlers resolve a config-only
   integration with the in-process overlay **never** populated; an unknown id
   still 404s (criterion 5).
5. Docstring on `getIntegrationDefinition`: request-serving callers must go
   through `resolveIntegrationDefinition`.

## Out of scope (checked, not changed)

- `integration-validation/validate.ts`'s sync wrappers (`validateOrder`,
  `mapToExternal`, `mapFromExternal`) also use `getIntegrationDefinition`, but a
  repo-wide grep finds **no** production callers — tests only.
- **SDK:** no change, no PyPI publish. No API surface moves; an error simply stops
  firing. Nothing in the SDK/MCP/README documents the flaky 404.

## Acceptance

Covered here: criteria 1, 3, 5, 6.
Post-deploy (pending after merge): criteria 2 and 4 — 20 consecutive
`call_external` for `weichert` across the scaled deployment with 0 404s, and a
publish on one instance visible to the outbound plane on every other. Then fill
in 0038's Validation log + Status in `~/repos/pegasus-workflows`.

## Outcome

Shipped as planned. One thing the plan did not anticipate: `db-access-guard.test.ts`
Guard 2 allowlists which handlers may import the unscoped base Prisma client, and
both outbound handlers now do — added with a justification comment alongside the
existing `integration-validation/validate.ts` entry, which is here for exactly the
same reason (a GLOBAL config row carries no `tenantId`, so the request-scoped
client cannot see it).

Regression guard lives in `apps/api/src/handlers/integration-outbound-config-only.test.ts`.
Unlike its sibling handler suites it deliberately does **not** mock the registry —
the real resolver runs against a fake Prisma serving one GLOBAL row, and every
case asserts `getIntegrationDefinition(id)` is still `undefined`, i.e. the
in-process overlay stayed cold while the call resolved anyway. That assertion is
the proof: it is the exact expression the old gate used.

Full suite green (2891 tests), typecheck + lint clean. No coverage floors moved.
