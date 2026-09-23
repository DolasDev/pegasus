# Architectural Decisions

- **YAGNI governs design choices**: When picking between options, prefer the idiomatic, flexible, resilient path — but only for capabilities the current milestone actually needs. Do not add tables, columns, variants, endpoints, queues, flags, or abstractions for hypothetical future requirements. If a second use case appears later, extend then. "Flexible" means the design can be extended without rewrites, not that every extension point is pre-built. When in doubt, ship the narrower surface.
- **Turborepo with npm workspaces**: Chosen for monorepo orchestration, parallel builds, top-level scripts, and fast caching.
- **Serverless AWS Backend**: Using AWS CDK to provision Lambda and API Gateway for the backend (`apps/api`).
- **Separation of Domain and Handlers**: `packages/domain` is strictly pure TypeScript with zero dependencies. Handlers (`apps/api`) invoke this domain logic instead of embedding it.
- **Edge-Ready API**: Uses Hono as the HTTP framework to keep Lambda instances fast and lightweight.
- **PostgreSQL on Neon**: A serverless database solution managed via Prisma ORM (`db:generate`, `db:migrate`).
- **Client-Side SPA Architecture**: `apps/web` (Tenant view) and `apps/admin` (Administrative view) are independent React 18 SPAs bundled with Vite and Tailwind CSS.
- **Runtime Config via /config.json**: Both SPAs fetch `/config.json` at boot instead of reading `VITE_*` env vars. CDK generates the file at deploy time using `s3deploy.Source.jsonData()` with resolved CloudFormation tokens. Local dev copies `public/config.json.example` → `public/config.json`. This eliminates build-time URL baking, `sed` manipulation, and SSM reads from `deploy.sh`.
- **Pegasus-Services integration uses polling, not WebSockets**: The legacy `WebSocketConnectionManager` and `EventPublisher` Lambdas (which pushed DynamoDB stream events to WS subscribers) are being dropped in the Hono migration. The Python integration service will poll `GET /api/v1/events/:eventType` on a timer instead. Rationale: the service already had a polling path; adding a WebSocket API Gateway stack adds CDK complexity and operational surface area for minimal latency gain given the non-realtime nature of move management events.
- **Document variants via eager derived-asset cache**: On upload, originals land under `.../{documentId}/original/{filename}` and an S3 `ObjectCreated` event triggers a dedicated converter Lambda that generates two fixed variants (`thumb` ~400px, `web` ~2000px) into `.../{documentId}/variants/{kind}.jpg`. Variant state lives in a dedicated `DocumentVariant` table (not JSON on `Document`) keyed by `(documentId, variant)` so the converter can upsert idempotently under S3 event retries. The `GET /:id/download-url` endpoint accepts `?variant=thumb|web|original` and transparently falls back to the original when a variant is `PENDING`, `FAILED`, or unsupported (MS Office / text), echoing a `variantStatus` field so frontends can poll. Originals are never mutated or deleted by the variant pipeline. Rationale: browsers can't render HEIC at all, and full-size originals burn bandwidth on every list/thumbnail render — eager generation covers every screen in the product today without the complexity of a lazy on-demand path.
- **Login tenant resolution is roster-only; `email_domains` dropped (2026-05-17)**: The `tenants.email_domains` array (a login-time tenant-resolution heuristic) was removed entirely — column, GIN index, Prisma field, API schemas, and admin-web UI. The `tenant_users` roster was always the real authorization gate (pre-token and `resolve-tenants` require a roster row regardless), so the domain array only added a fragile, divergent code path — a leftover smoke-test tenant with `email_domains = {gmail.com}` was silently capturing every `@gmail.com` login. Resolution is now a pure roster lookup keyed by the authenticated user. Consequence: **invites are unrestricted** — any email may be invited to any tenant, and roster membership is the sole gate. This is intentional (it keeps cross-org / contractor invites working); there is no "domain not allowed" failure mode at invite or login time.
- **Migrated longhaul handlers reach tenant MSSQL via a dedicated in-VPC executor Lambda (2026-05-18)**: As longhaul endpoints migrate off the on-prem proxy onto the cloud Hono Lambda, they need to query tenant MSSQL on the WireGuard overlay. The main API Lambda has no VPC attachment (it needs public egress for Cognito/Neon/S3, and VPC attachment adds ENI cost + a cold-start penalty on _every_ request). The overlay is only reachable from the WG VPC's isolated subnet, which has no internet egress — so a single Lambda can't have both without a NAT gateway. Decision: migrated handlers stay in the main Hono app (they do the Neon connection-string lookup and author SQL) and invoke a dedicated `mssql-executor` Lambda (`apps/mssql-executor`) that lives in the WG VPC and runs the raw SQL. The connection string is passed in the invoke payload, so the executor needs no Neon access. This mirrors the existing `tunnel-proxy` Lambda exactly and isolates the VPC cold-start cost to longhaul requests. Rejected alternatives: VPC-attaching the main Lambda (penalises all traffic) and a separate API-Gateway-routed Lambda (needs NAT for Neon/Cognito, loses Hono mount-precedence routing). Established by Phase 1 of the longhaul strangler-fig migration.
- **Driver field is locked on In-Progress trips (2026-05-30)**: Restoring legacy parity, `DriverTripDetail` (Planning's PendingTrips pane) renders a read-only "locked" display (lock icon + driver name + "(locked — trip in progress)" subtitle, `data-target="driver-locked"`) when `currentTrip.status?.status === 'In-Progress'`, instead of the Downshift typeahead. A dispatcher can't silently reassign a driver mid-haul, matching the Electron app's behavior. Plan: `plans/completed/longhaul-in-progress-driver-lock.md`.
- **RLS deferred — app-layer guards chosen over Postgres Row-Level Security (2026-06-17)**: Tenant isolation is enforced by the `createTenantDb` Prisma extension (applied per-request in tenant middleware) plus two CI guards: (1) the schema-sync test (verifies every `tenantId` model is acknowledged in `TENANT_SCOPED_MODELS`) and (2) the db-access-guard test (enforces a frozen allowlist of handlers permitted to import the unscoped base client). RLS would require a per-request `SET app.current_tenant` in a transaction wrapper (awkward with pooled Neon connections), a `BYPASSRLS` split for the ~31 cross-tenant call sites used by admin/auth/crons/longhaul, and a multi-week migration. The guards defend the same failure mode (a handler accidentally querying another tenant's data) with ~2 hours of work. Revisit only on a compliance driver (SOC 2 / enterprise due diligence).
- **Workflow visualization = author-declared Mermaid diagram, not code analysis (2026-06-27)**: Published workflows are opaque Python in S3, so the tenant UI can't infer what a workflow does. Rather than statically analyzing the Python (fragile — misses dynamic dispatch, loops, helper indirection) or forcing an in-code step-DSL (invasive), the SDK's `pegasus-workflows diagram` AI-generates a Mermaid flowchart from the source into an author-editable `<source_dir>/workflow.mmd`, embedded in the bundle (so it is covered by `artifactSha256`) and **required** at publish time. The diagram is _author-declared_, so the UI pairs it with a _verified envelope_ built from data the platform actually stores and trusts — triggers + `requiredActions` — so business users see the declared flow next to the platform-guaranteed permission boundary. Trade-off accepted: the diagram is an assertion about the code, not a proof; pinning it to the artifact version + showing the verified envelope alongside is the mitigation.
- **Workflow execution payloads must be PII-free; Temporal payload codec deferred (2026-06-27)**: Developers inspect executions two ways — tenant developers via an in-app, tenant-scoped event-history timeline (the API authz-filters by tenant), and platform engineers via the read-only Temporal Cloud console (full native fidelity). The Temporal Cloud UI has **no per-tenant isolation** (a namespace is cross-tenant), and Temporal stores workflow input/result/history in plaintext, so the console is surfaced only in admin-web (for already-cross-tenant-trusted platform engineers), never in the tenant app. The convention is therefore that workflow inputs/results carry **entity ids, not raw PII** (look details up inside an activity). A Temporal payload codec (client-side payload encryption) is the proper fix and is deferred until this convention can't hold. Cancel/retry are tenant-app-only and gated by new Cedar actions (`CancelWorkflowExecution` / `RetryWorkflowExecution`).
- **The published event catalog IS the record vocabulary, exactly — 33 members, closed, `specVersion` 0.1.0 (2026-09-21)**: The reference model's integration events are `packages/domain-reference/src/vocabulary.ts`'s 31 assertion types plus `FactResolved` and `Correction`, with **no coarser published layer** over them. A coarse published type sitting above the fine one is a _second classification axis_, which `00-shared-decisions.md` §1.1 forbids permanently; the stability that layer was wanted for comes instead from A-TYPE (the `type` names the act, never the outcome, so the vocabulary does not grow with outcomes × reasons), addition-only versioning, and the derived subject/fact-class families used as _filter_ axes rather than as published types. The vocabulary is **closed** rather than EPCIS-style open-by-URI, because E-TYPE rejects an unknown type at the boundary and E-CANON requires a per-type declaration in one place — neither survives tenant-minted types; the accepted cost is DCSA's, where a new enum value is a release event. Two schema faces are published, not one with an optional field, because `recordedAt` is forbidden on capture and mandatory on query. Consumers **validate against the `specVersion` the record carries**, never a pinned one, and treat an unfamiliar closed-enum member as unhandled rather than invalid. Version is `0.1.0` and not `1.0.0` deliberately: 19 of 31 authority rows, the A4 reason vocabulary and findings F3/F4/F5 are still owed, and that inventory ships inside `catalog/index.json` so a consumer sees the gaps without reading the analysis. Decision: `docs/domain-reference/analysis/published-event-catalog.md` (cited as `[catalog §x]`). Everything under `docs/domain-reference/catalog/` is **generated** — `npm run catalog -w @pegasus/domain-reference` — and gated by `tests/conformance/catalog.test.ts`.

## Domain reference — the A4 reason vocabulary is published, and the catalog is `0.2.0`

`00-shared-decisions.md` §2.4 fixed the reason record's shape and left the code list to A4. It is now
published: **23 members**, decided in `docs/domain-reference/analysis/A4-execution-events.md` (cited as
`[A4 §x]`), named in `REASON_CODES` in `packages/domain-reference/src/outcomes.ts` with one JSDoc of
evidence each, and tabulated per code in `data/reasons.json` — default scope, whether
`attribution.party` must name a party, whether a remedy is required and which shape, disclosure marker,
citations. The loader holds the two to one set in both directions; a code in one place and not the other
is a defect, not a widening. `ReasonCode` is a closed union rather than a branded string, so
`reasonCode()` is a boundary parser and `Portion.basis` is constrained to a published member.
`NewWindow` types the single remedy shape a source states; every other shape stays `Owed`, and the one
that opens a storage-in-transit stay is owed to A5.

**Reasons are orthogonal to outcomes, and that is the whole design.** `GOODS_DAMAGED` is Shippeo's
`LIV/RCA` (accepted with damage) _and_ its `REN/AVA` (refused for damage); `SITE_INACCESSIBLE` at
`COMPLETED_WITH_EXCEPTION` says "performed with a shuttle, and it costs more" — a cell no source in the
corpus has. Enforced two ways and both are partial: `ReasonCodesAreOutcomeFree` at compile time,
`outcomeWordIn` at run time; neither catches an outcome hidden in a **verb**, and two placeholder
literals (`PARTIAL_LOAD`, `ALREADY_PERFORMED`) had to be caught by reading. All three of §2.6's worked
literals turned out to be unpublishable — `CONSIGNEE_ABSENT` bakes a role into the code, which rule 6
forbids — and §2.6 now carries the mapping as a footnote.

**Only 3 of 23 members are marked.** §2.4's note that the `SITE`/`ADMINISTRATIVE` examples are "none of
which **Shippeo** has" had been read as "no source publishes these". It is not: `src:dp3-400ng` Item
125.1 **enumerates** the valid shuttle causes and Item 33 adds impractical operations, so the shuttle
reason is regulation-grade. `src:cfr-49-375` §375.401(f) names elevators and long carries, though only
as pre-BOL accessorials, so the execution-time reading is `[SYNTHESIS]`. Only a parking permit is
`[ORIGINAL]`, and COI-not-on-file is an _instance_ of `DOCUMENT_MISSING_OR_INCORRECT`. **Read the
sentence a document actually wrote, not the summary of it** — a claim about one publisher does not
license a claim about the corpus.

**Publishing a vocabulary that shipped owed is its own compatibility class.** It narrows `string` to an
enum, which _restricts_ the captured face — a producer sending an unrecognised code was valid and is
now rejected. Added as `publishedOwedVocabulary` in `ADDITIVE_CHANGES` and classified additive because
the `x-owed` marker was itself published on the wire, so no conforming producer could have relied on a
code being accepted. The restriction is recorded with the class. The owed code's `$defs` entry
**disappears** on publication, because a closed union of string literals inlines as an `enum`.
`CATALOG_VERSION` is **`0.2.0`**; what keeps it pre-1.0 now is the authority rows — 19 of 31 — and three
still-owed vocabularies (`roleClass`, `unitOfMeasure`, `identityScheme`), which the owed ledger could not
even see until this work.

## Domain reference — A1: the order's stage is a projection, and A8's order rows were misdiagnosed

**The entries above are dated records of their own round.** Where one names a `specVersion` or an owed
count, read it as "at that decision", not as current: the live numbers are `CATALOG_VERSION` in
`packages/domain-reference/src/catalog.ts` and `owed.counts` in `docs/domain-reference/catalog/index.json`.
A1 removed the copies of those numbers that were neither dated nor gated.

**A1 (order & service lifecycle) is decided in `docs/domain-reference/analysis/A1-order-service-lifecycle.md`**
(cited as `[A1 §x]`). It mints no type, aggregate, field or qualifier. What it adds:

- **An order's stage is a projection, not a field and not a record** — `orderStageAt`, rule
  `ORDER-STAGE-AT` v1, in `src/rules/order-stage.ts`. The second projection in the package and the same
  shape as `custodyAt`, for the same reason: `00-shared-decisions.md` §1.1 forbids a mutable
  current-state field on the envelope. Five stages — `UNAWARDED`, `AWARDED`, `ACCEPTED`, `DECLINED`,
  `CANCELLED` — plus an `UNKNOWN` with six named reasons, against the corpus's eight- and nine-value
  ladders: every value those spend on _who_ ended the order rides `reasons[].attribution` instead. The
  fold does not read `context[]`, which is what makes an accepted order with **zero** shipments ordinary
  rather than a special case.
- **X12 element 558 mapped.** `A` Reservation Accepted → `COMPLETED`, **`B` Conditional Acceptance →
  `COMPLETED_WITH_EXCEPTION`**, **`C` Counter Proposal → `NOT_COMPLETED`**, `D` → `orderCancellation`, a
  different type. The discriminator is _does a commitment stand?_, and the test of the mapping is that
  `A` and `B` reach the **same stage**.
- **A refused cancellation does not govern**, so an order whose cancellation was refused is still
  `ACCEPTED`. **A response with no award behind it is `UNKNOWN`** — `[ORIGINAL]`, the commitment-side
  twin of the custody fold's C5, refusing to let a commitment exist on one party's word.
- **One reason code, `DEADLINE_LAPSED`** (`newClosedEnumMember`, catalog → `0.4.0`), and three
  deliberate refusals to mint: a price counter-proposal is a `charge` at `aspect = PROPOSED`, a
  "this party does not handle this" fact needs the party entity A8 owes, and short fuse is a property
  of the award rather than a reason on the answer.

**And it corrected `[A8 §9 item 8(b)]`, which outranks it.** A8 said no source in the corpus attaches an
authority to the order lifecycle. Four attach a **party** to every order transition — that is
_permission_, not assertional authority, but it is the same kind of material A8 §10 says its own rows
1-5, 8 and 11 were built from. What actually blocks `orderResponse` and `orderCancellation` is that A8
§4.3's `boundBy` enum has **no member for a role resolved by the order's own award**; `orderAward` alone
stays blocked by A8's own mint principle. A8 gained `(b-i)` and revision 8 in the same PR, and the
corpus-blocked count went from twelve to nine. **A disagreement between two binding documents is a
defect, so the correction lands in both or in neither.**

## Domain reference — A2: the shipment boundary is the undertaking, and nothing publishes one

**A2 (shipment structure) is decided in `docs/domain-reference/analysis/A2-shipment-structure.md`**
(cited as `[A2 §x]`). It mints no type, aggregate, field, qualifier or reason code, and — a first —
it **does not bump `CATALOG_VERSION`**, because both emitted schemas came out byte-identical. What it
adds:

- **Rule B-ONWARD, `shipmentContinuity` in `src/rules/shipment-continuity.ts`.** Onward movement of
  the same goods continues the same shipment unless a **new undertaking** was made over them; the
  transport document is the record a commitment leaves, never the thing that makes it new. Diversion,
  a split at a transshipment point and delivery out of SIT keep the shipment; **reshipment after
  termination is a second shipment**, because `src:dtr-part-iv` #81 makes a bill of lading the
  contract by which the TSP agrees to furnish transportation and §E.4(4)(c) issues a new one. This
  **closes `00-shared-decisions.md` §10.4 bullet 1**, the oldest open item in the model — A5 had
  closed the stay half.
- **B-DOC is sharpened, not reversed**, and gains a second reason it is `[ORIGINAL]` that
  `fork-order` §3.2.2 did not carry: the system it was read off **separates award, survey and
  document** (DTR §C.4; §F.1 NOTE), so reading identity off the document is not DoD's rule either.
- **No shipment-type vocabulary, and `fork-order` §3.1's promise of one is withdrawn.** Six sources
  publish a closed shipment-type enum and **no two decompose into the same facets**; three of the
  facets are other aggregates' facts (`PPM`/`shipperType` → `partyRole`; `NTS`/`NTSR`/`LTS` → the
  permanent-storage boundary `[A5 §3.4(c)]` put outside the model; `JobType` → services ordered) and
  one is A12's (rate family). Each is a **rating or routing key**, not an ontology. `shipmentType` is
  absent and owed; a union would be a cross-product and `[catalog §2.3]` makes a member's spelling
  breaking.
- **`00-shared-decisions.md` §11's mandatory Portion revisit check is run and passes.** No published
  HHG model keeps enumerated and measured subsets as different entities — `src:dp3-400ng` Item 17.13
  requires **both of one subset** — and the "Split Shipment" is **one** shipment, which is positive
  evidence for `P-IDENTITY` rather than a strain on it.

**The structural finding, which is the round's largest output: the `shipment` aggregate has no record
of its own coming into existence.** Every act row in §4.7.1 presupposes one. So `fork-order` §5.2's
**B-STAGE has been a projection with no input records since it was written**, B-ONWARD is decidable
in prose and returns `COMMITMENT_NOT_PUBLISHED` in code, and an `[A1 §3.4]` `COMPLETE` rule cannot
read the set it would quantify over. `shipmentCommitment` is recorded in `ABSENT_AND_OWED`, and its
blocker is **not** A5's missing party entity: it is the same `[A8 §4.3]` `boundBy` gap A1 found, so
**four things now wait on one enum member** — the cheapest remaining move on the owed count.

**And it audited a claim the resumption plan made.** `00-shared-decisions.md` §10.2's seventeen
required changes to `fork-order-shipment-cardinality.md` were described as A2's inheritance; all
seventeen were **already applied** across that document's revisions 2-5. `[A2 §1]` carries the
item-to-revision table. **Check what a plan says is owed before building on it.**
