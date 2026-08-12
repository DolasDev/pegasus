# Reporting phase 2 — publishable dashboards, forking, and a per-user default view

> **Status: APPROVED 2026-08-12 — editor form factor chosen (drag-and-drop grid canvas).**
> Branch `feat/reporting-dashboards-phase2`, worktree
> `/home/steve/repos/pegasus-reporting-dashboards-phase2`. Builds directly on phase 1
> (#620/#623, `plans/completed/2026-08-11T1730-reporting-dataset-catalog.md`).

**Goal:** turn the phase-1 built-in constant into **persisted, versioned, publishable,
forkable** dashboards that users author in a drag-and-drop grid, and let each user pick
their own default view from their profile.

Phase 1 deliberately pre-paid for this: the render path already consumes a Zod-validated
`DashboardDefinition` document, `ReportingPage` already takes a `definition` prop (the
loader seam), and a round-trip test already proves a JSON row substitutes for the code
constant. **This phase should not need to touch the render path.**

---

## Decisions taken

1. **Drag-and-drop grid canvas** (user's call, 2026-08-12) — `react-grid-layout`: drag to
   move, drag-edge to resize, live preview. Not a form builder.
2. **Persistence mirrors `IntegrationConfig`'s lifecycle**, which already solves exactly
   this problem: monotonic `version` per key with immutable publishes, `visibility`
   TENANT/GLOBAL derived server-side from `isPlatformTenant`, supersede-on-publish
   `status`, `publishedBy`, `forkedFrom*`. Do not invent a parallel lifecycle.
3. **NOT in `TENANT_SCOPED_MODELS`.** Same reason `IntegrationConfig` is excluded: the
   GLOBAL fallback read must cross the tenant boundary deliberately, so scoping is
   explicit in a repository. ⚠️ This is the security-critical decision of the phase —
   every read must carry its own `tenantId`/`visibility` predicate.
4. **The per-user default stores a SLUG, not an id.** An id pins one immutable version,
   so a user's default would silently freeze at the version current when they set it.
   A slug resolves to "latest PUBLISHED for this slug that I can see", which also makes a
   tenant fork transparently shadow the GLOBAL original.
5. **Authoring is `tenant_admin`-only in this phase, granted purely by its wildcard
   policy — no persona file is edited.** That is deliberate: it sidesteps
   [[trap 2]] (`apps/e2e/tests/api/authz-smoke.spec.ts` pins `viewer`/`sales` exactly and
   only runs post-merge in the staging gate). Widening authorship later is one persona
   line + that spec, in the same commit.

---

## Data model (one expand-only migration)

```prisma
enum DashboardVisibility { GLOBAL TENANT }
enum DashboardStatus     { PUBLISHED SUPERSEDED ARCHIVED }

model DashboardDefinition {
  id       String @id @default(uuid())
  tenantId String @map("tenant_id")          // platform tenant owns GLOBAL rows
  slug     String                            // stable identity across versions
  version  Int                               // monotonic per (tenantId, slug)
  visibility DashboardVisibility @default(TENANT)
  status     DashboardStatus     @default(PUBLISHED)
  title       String
  description String?
  definition  Json                           // the portable document (widgets[])
  publishedBy String  @map("published_by")   // TenantUser.id, denormalized, not an FK
  forkedFromDefinitionId String? @map("forked_from_definition_id")
  forkedFromVersion      Int?    @map("forked_from_version")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")
  @@unique([tenantId, slug, version])
  @@index([tenantId, status])
  @@index([slug, visibility, status])
  @@map("dashboard_definitions")
  @@schema("public")
}
```

Plus `TenantUser.preferences Json?` — Zod-parsed-with-defaults exactly like
`Tenant.appSettings`, so adding a future preference is a code change and not a migration.
First and only field: `defaultDashboardSlug`.

**Expand-only** — two new nullable/defaulted additions and one new table. No drops, no
renames, no `SET NOT NULL`. Rolling back the code is safe, so no contract marker.

## Resolution rules (the part that must be right)

- **Visible set** for a caller = the tenant's own `PUBLISHED` rows ∪ `GLOBAL` `PUBLISHED`
  rows, with the tenant's own row **shadowing** a GLOBAL row of the same slug.
- **Default view** = latest visible `PUBLISHED` row for `preferences.defaultDashboardSlug`;
  falls back to the built-in when unset, missing, or archived. A dangling default must
  never render an error — the user did not do anything wrong.
- **Publish** = insert `version = max+1` for `(tenantId, slug)` and flip prior `PUBLISHED`
  rows of that lineage to `SUPERSEDED`, in one transaction.
- **Fork** = copy a GLOBAL row's definition into a TENANT row at `version = 1` of the same
  slug, recording `forkedFrom*`.

## Server-side validation of a submitted definition

The document is user-authored, so the API must not trust it:

- Parse against the same Zod schema the frontend uses (shared shape, declared server-side).
- Every `datasetId` must exist in the registry → else 400 naming the unknown ids.
- The caller must hold each referenced dataset's `requires` action → else 403. **Without
  this, a tenant_admin could author a dashboard that a lower-privileged user later opens,
  and the query endpoint's own gate is what stops the read — but the definition would
  still leak which datasets exist.** Belt and braces; the query path already fails closed.
- Each widget's `params` must satisfy that dataset's own schema.
- `widgets.length` ≤ 12 (matches `MAX_BATCH`; a 13-widget dashboard would 400 at render).
- `datasetVersion` mismatch vs the registry is recorded as a **warning**, not an error —
  that is the drift signal, and blocking on it would break every stored dashboard the
  moment a dataset bumps.

## Endpoints (all standalone, no edits to phase-1 paths)

| method | path                                      | gate                                     |
| ------ | ----------------------------------------- | ---------------------------------------- |
| GET    | `/api/v1/reporting/dashboards`            | `ReadReportingDataset`                   |
| GET    | `/api/v1/reporting/dashboards/:slug`      | `ReadReportingDataset`                   |
| POST   | `/api/v1/reporting/dashboards`            | `ManageDashboards` (publish new version) |
| POST   | `/api/v1/reporting/dashboards/:slug/fork` | `ManageDashboards`                       |
| DELETE | `/api/v1/reporting/dashboards/:slug`      | `ManageDashboards` (archive lineage)     |
| GET    | `/api/v1/me/preferences`                  | none beyond auth (own profile)           |
| PATCH  | `/api/v1/me/preferences`                  | none beyond auth (own profile)           |

New Cedar action `ManageDashboards` → `dashboard:manage`, resource type `Report` (reuse —
no new entity type needed). Reading stays on `ReadReportingDataset`.

## Frontend

- `/reporting` gains a **dashboard picker** (own + GLOBAL, fork affordance on GLOBAL) and
  a **"Set as my default"** control writing `/me/preferences`.
- `/reporting/edit/:slug` and `/reporting/new` — the grid canvas. `react-grid-layout`:
  12-column grid, drag handle on each card header, resize from the corner, add-widget
  drawer listing the catalog (only datasets the caller can run), per-widget settings
  (title, widget kind, params from the dataset's `paramsSchema`), then Publish.
- `DashboardDefinition` gains `layout` per widget (`x`, `y`, `w`, `h`) — **`span` stays**
  as the fallback so every phase-1 document still parses. `schemaVersion` goes to 2 with a
  1→2 upgrade that derives `x/y/w/h` from `span`; phase-1 rows must keep rendering.
- Render path (`ChartCard`, `Series`, formatting) is **untouched** — if this phase edits
  it, phase 1's seam was wrong.
  ⚠️ **Amended during implementation:** `ChartCard` needed two lines after all. It carried
  its own `md:col-span-*` class derived from `span`, and a fixed `h-48` chart box. Inside a
  grid the CELL owns geometry, so the card now fills its cell (`h-full`) and no longer reads
  `span` — otherwise two sources of truth compete for width. The data path (fetching,
  per-slot degradation, formatting, chart specs) is genuinely untouched.

## Checklist

- [x] Prisma: enums + `DashboardDefinition` + `TenantUser.preferences`; migrated and client
      regenerated. Migration is purely expand-only (CREATE TYPE / ADD COLUMN nullable /
      CREATE TABLE / CREATE INDEX) so no contract marker is needed.
      **Also had to acknowledge the model in `prisma-tenant-isolation.test.ts`'s
      INTENTIONALLY_UNSCOPED list** — a guard test catches any new `tenantId` model missing
      from TENANT_SCOPED_MODELS, which is exactly the check R1 wants to exist
- [x] `dashboard-definition.repository.ts` — publish / fork / archive / visible-set /
      resolve-by-slug; 9 integration tests against real Postgres, including cross-tenant
      isolation and "archiving a fork falls back to the GLOBAL original"
- [x] `lib/user-preferences.ts` — Zod-with-defaults + 7 tests (null column hydrates,
      unknown keys dropped, per-section merge never wipes a sibling)
- [x] Cedar: `ManageDashboards` + schema entry; **zero persona file edits**, so the
      post-merge `authz-smoke` trap is sidestepped entirely
- [x] `reporting/definition-validation.ts` — unknown dataset → 400, unreadable dataset →
      403, bad params → 400, version drift → warning
- [x] `handlers/reporting-dashboards.ts` — 5 routes + 21 tests
- [x] `/me/preferences` GET+PATCH
- [x] `schemaVersion` 2 + the 1→2 upgrade — 13 tests. The built-in is deliberately STILL
      authored as v1 so the upgrade keeps real-document coverage
- [x] Frontend: queries, picker, set-default, fork
- [x] Frontend: grid editor, add-widget drawer, per-widget settings rendered FROM each
      dataset's `paramsSchema`. NOTE: react-grid-layout **v2 restructured its API** — flat
      props became `gridConfig`/`dragConfig`/`resizeConfig`, `compactType` became a
      `compactor` function, and it now ships its own container-measuring hook
- [x] `ReportingPage` resolves ?dashboard= → user default → first visible → built-in, every
      step falling back SILENTLY
- [x] OpenAPI entries for all 7 routes + 3 schemas
- [x] Full gate (15/15, all four coverage floors raised) + `audit-ci` clean
- [ ] PATTERNS.md; archive plan; `/workstream-finish`

## Risks

- **R1 — cross-tenant leakage via the GLOBAL read.** The model is deliberately outside
  `TENANT_SCOPED_MODELS`, so a missing predicate leaks another tenant's dashboard. Every
  repository method takes `tenantId` explicitly and there is a test asserting a second
  tenant's rows are invisible.
- **R2 — `schemaVersion` bump must not orphan phase-1 documents.** The built-in and any
  row written pre-upgrade are `schemaVersion: 1`. The parser upgrades rather than rejects.
- **R3 — `react-grid-layout` is a new dependency** with its own CSS. Confine it to the
  editor route so the read path keeps working if it misbehaves; run `audit-ci`.
- **R4 — authoring is admin-only**, which is a real product limitation, not an oversight.
  Stated so it is a decision rather than a surprise.
- **R5 — a dangling `defaultDashboardSlug`** (archived, or a fork removed) must fall back
  silently to the built-in, never error.
