---
source: src:milmove-docs
analyzed: 2026-09-17
evidence_grade: B
material: |
  All paths relative to sources/milmove-docs/captured/mymove-docs/docs/.
  Read in full:
    api/docs/push-notifications-to-prime.md
    backend/guides/how-to/add-an-event-trigger.md
    backend/guides/guide-to-history-and-audit-logging.md
    backend/guides/ghc/ghc-invoicing.md
    backend/guides/ghc/ghc-rate-engine.md
    backend/guides/roles-and-permissions.md
    backend/guides/route-planner.md (lines 1-45)
    backend/guides/edi/index.md
    integrations/gex/index.md
    api/guides/how-to-deprecate-endpoints.md
    api/guides/api-style-guide.md (lines 1-50)
    frontend/guides/how-to-add-move-history-events.md
    adrs/0055-consolidate-moves-and-mtos.md
    adrs/0043-prime-time.md
    adrs/0060-move-state-for-service-counseling.md
    adrs/0067-ppm-db-design.md
    adrs/0071-move-history-events.md
    adrs/0042-optimistic-locking.md
    adrs/0049-etag-for-child-updates.md
    adrs/0038-soft-delete.md
    adrs/0051-swagger-date-formats.md
    adrs/0078-api-versioning.md (lines 1-90)
  Surveyed (titles only, 85 ADRs listed in adrs/, 348 files in the capture).
  Not read / not readable - see "What we could not read".
---

# MilMove documentation site and ADRs (`transcom/mymove-docs`) - analysis

## What it is

The Docusaurus documentation site for MilMove: 85 numbered ADRs plus backend, API,
frontend, integration and tooling guides. Same publisher as src:milmove-mymove
(USTRANSCOM / TrussWorks), MIT-licensed, `public` (S3). **S1 kind:** this is not a
reference model or a standard - it is the *design rationale* behind one
(`internal-system` documentation). **S2 adoption:** 1 - it documents one system, nobody
else implements it. Its value to us is not vocabulary (the code has better vocabulary) but
**decisions and their reasons**: why moves and MTOs were merged, how time is handled, how
the mover is notified of change, how an API is deprecated without breaking a partner.

**Evidence grade B.** The rubric reserves A for reading the actual spec/source; this is
implementation guidance and decision records *about* a source we read separately at grade
A. Everything quoted below was read in full from the captured Markdown - but a large part
of the substance this site points at is behind links we cannot follow, which is the
honest reason for B rather than A.

### What we could not read

- **All diagrams.** The capture contains no `static/`, no images. The push-notification
  design turns on three figures - `/img/webhooks/subscribe-notifications.png`,
  `generate-notifications.png`, `send-notifications.png` - and the logical-object map
  `/img/webhooks/push-objects.png`, which is the *authoritative* statement of which DB
  tables belong to which published object. We reconstructed that map from the prose list
  and from `pkg/services/event/notification.go`; we never saw the picture.
- **Gated Google Docs**, repeatedly the real content:
  - "Webhooks for Milmove Design Doc" (`add-an-event-trigger.md:14`) - the full design.
  - EDI 858 structure "with segment significance and source data mapping"
    (`backend/guides/edi/index.md`), and the EDI-response (997/824) field mapping
    spreadsheets (`ghc-invoicing.md:95-96`).
  - The whole of `ghc-rate-engine.md` - 19 lines, every one of them a link out to a
    Google Doc or Sheet (pricing template, service item codes, "inputs needed for pricing
    service items", "how to price a service item"). **The rate engine is effectively
    unread.**
  - ~18 further design docs listed under "GHC Invoicing Mini Design Docs"
    (`ghc-invoicing.md:66-83`), including "Payment Request proposed model", "Recording
    Errors from 997 or 824", "SIT Pricing Notes", "Reweighs: Invoicing engineer".
  - Miro boards, including the **Payment Request state diagram**
    (`ghc-invoicing.md:86`) - i.e. the one authoritative state machine we most wanted.
- **Atlassian pages marked with a padlock** in the source text: "PO9 Technical
  Implementation" (the move-history table design,
  `guide-to-history-and-audit-logging.md:14`), GEX setup pages, PPM Bookings Technical
  Discovery.
- **Slack threads** cited as the resolution of open design questions in ADR 0055
  (locator vs reference_id) - `ustcdp3.slack.com`, not public.
- Of the 348 captured files we surveyed titles and read the 22 listed above; ~60 files
  on CI, Docusaurus, Playwright, Locust, Okta and Go tooling were skipped as
  domain-irrelevant. ADRs read: 0038, 0042, 0043, 0049, 0051, 0055, 0060, 0067, 0071,
  0078 (partial). The other 75 were surveyed by title only.

## Model summary

The site contributes five things to a domain reading. None of them is an entity model -
that is what the code is for.

### 1. Why Move and MTO are one thing (ADR 0055)

The decision record that collapsed `moves` and `move_task_orders` into one table, and the
best short definition of the central concept anywhere in either source:

> **MTO - Move Task Order**. Is similar to an order for goods from a contractor. In the
> case of MilMove, the TOO is ordering services from the Prime Contractor. When the Prime
> Contractor completes those services, they can request payment for those services.
> **Every service the Prime undertakes must be "ordered."** The government does this via a
> Move Task Order. It is the record of everything that is ordered (approved) for the Prime
> to do. (`adrs/0055-consolidate-moves-and-mtos.md:133-140`)

And the argument for the merge: "an MTO is essentially a move that is available to the
Prime" (`:111-112`). The cost is stated too - "By not having a separate DB table for MTOs,
there is a risk we might not be representing an MTO accurately. **An MTO is a legal
construct with specific requirements**" (`:119-121`) - and the option it closes off is
named: "Allows for the possibility of multiple MTOs for a single move" (`:103`).

The field-by-field definitions (`:44-90`) are the source for our identifier notes:
`locator` is "a 6-digit alphanumeric value that is a sharable, human-readable identifier
for a move (so it could be disclosed to support staff, for instance)"; `reference_id` is
`dddd-dddd` and "does serve currently as the prefix for payment request numbers";
`available_to_prime_at` "indicates when the move is available for the Prime to handle. The
presence of this field can be used to determine whether or not to display the move to the
Prime"; `contractor_id` exists so it is "easy to point the move to a different contractor
in case it changes."

### 2. How the mover is told about change (push-notifications-to-prime.md)

Three components, named as such: **Subscribe to Notifications**, **Generate
Notifications**, **Send Notifications** (`:23-27`). The design points we care about:

- **Why events at all**: "For this to work, all updates to objects that are of interest to
  the Prime should trigger an event" (`:17`).
- **A subscription is** "`Object+verb event code`, `subscriberID`, `url` to contact and
  `subscription` status" (`:37-38`) - and self-service subscription endpoints were
  deliberately skipped because "With only one subscriber, endpoints for self-service have
  limited value" (`:40-43`).
- **Choosing granularity, stated as an explicit trade-off**: "For notifications, we need to
  break down our MTO into smaller logical objects to be able to send over smaller updates
  than the full MTO... We do not want to send the whole MTO on each event, not do we want
  to send a single address record. Instead we have picked a set of logical objects that
  match updates that the Prime would like to see." (`:86-92`)
- **The five logical objects and their membership** (`:96-102`):
  - Move = `Move` + `Contractors`
  - Orders = `Orders` + `Customer` + `Entitlement` + `DutyStation` + `Address`
  - MTOShipment = `MTOShipment` + `Agent` + `Address`
  - MTOServiceItem = `MTOServiceItem` + `MTOServiceItemDimensions` + `MTOServiceItemCustomerContacts`
  - PaymentRequest = `PaymentRequest` + `PaymentServiceItems` + `PaymentServiceItemParams` + `Uploads`
  - "What this means is an update to an address on an MTOShipment should result in an
    'MTOShipment.Update' event." (`:104`)
- **The event package is deliberately generic**: "The event package is generic and services
  all events for all internal and external needs. It will not sanitize or assemble the data
  for the Prime notifications." (`:84`) - i.e. one internal event bus, many consumers, each
  deciding its own payload and its own suppression rules.
- **Decoupled delivery**: a separate `webhook-client` polls the notifications table and
  sends. "The app will be asynchronous to the rest of the handling of the event. This is
  intentional to avoid increasing the time to execute the handler." (`:138`)
- Transport detail specific to them but worth noting as a pattern: mTLS to the subscriber
  (`:19`).

The companion how-to (`backend/guides/how-to/add-an-event-trigger.md`) adds the operational
rules:

- **"RULE OF THUMB - Every endpoint in the ghcapi.yaml file should have an event trigger
  call in the top level handler."** (`:16`)
- **Trigger only on success**: "You trigger an event by inserting a call to TriggerEvent on
  the SUCCESSFUL completion of the handler's action... If the actual payment request update
  failed, we don't trigger the event as there was no successful action taken." (`:22-36`)
- **Failure to notify never fails the action**: "If the event trigger fails, just log the
  error." (`:52-55`)
- **Why grouping exists**: "There are too many tables in our MTO to update the Prime about.
  To reduce the granularity, we have grouped the tables into the following logical objects"
  (`:62`), and "The events are always `<LogicalObject>.<Verb>` events, so if you update any
  table under PAYMENT REQUESTS, like payment_service_items, the event is
  `PaymentRequest.Update`." (`:66`)
- **The id you publish is the aggregate's**: "If you updated payment_service_items, your
  UpdatedObjectID is the UUID of the associated Payment Request." (`:74`)
- A candid note on the naming debt left by ADR 0055: "It is called MtoID because we
  recently consolidated the Move and MTO tables so in our DB they are the same, but Prime
  understands Move Task Order" (`:78`) - **the published vocabulary was kept stable while
  the internal one changed.**

### 3. Two histories, not one (history-and-audit-logging, how-to-add-move-history-events, ADR 0071)

MilMove runs a **second**, independent change stream beside the webhook events, built on
Postgres triggers:

> "when a move is created, changed, or edited, our move history component displays the
> who, what, and when of those changes. We achieve this through the use of database
> triggers monitoring certain tables; whenever data in those tables is inserted, deleted,
> or updated, a record is inserted into our audit_history table"
> (`frontend/guides/how-to-add-move-history-events.md:5`)

Adding a table to it is a migration:
`SELECT add_audit_history_table(target_table := 'table_name', audit_rows := BOOLEAN 't',
audit_query_text := BOOLEAN 't', ignored_cols := ARRAY['created_at','updated_at']);`
(`:34`).

Two caveats stated by the authors themselves
(`backend/guides/guide-to-history-and-audit-logging.md:19-22`):

> - Events initiated by the system are logged as null users
> - Changed data is stored as a JSON string, and to date all data is saved as strings
>   regardless of initial data type

Rendering a raw audit row into something a human understands needs a **template keyed on
`(action, eventName, tableName)`** - `action` being `INSERT`/`UPDATE`/`DELETE`, `eventName`
being the API `operationId`, `tableName` the changed table (ADR 0071; and
`how-to-add-move-history-events.md:7`, `:147-153`). ADR 0071's motivation is worth noting
as a warning about catalogue maintenance: one 550-line file holding 32 event templates,
"has proven to lead to many merge conflicts", "non-trivial to verify which event names
have been added", with another 21 expected - the fix being one module per event with its
test beside it (`adrs/0071-move-history-events.md:57-108`).

A structural consequence for us: because the audit stream is keyed on *tables*, assembling
the history of one move requires a hand-written SQL fetcher that joins every audited table
back to the move, and adding a new tracked thing means adding a new CTE and a `context`
JSON blob to carry fields the audit row does not have
(`how-to-add-move-history-events.md:56-96`).

### 4. Time (ADR 0043, ADR 0051)

ADR 0043 "Handling time in the Prime API" is the clearest statement of a two-resolution
time model we have seen in any source:

- Definitions: **Date** = "a time value that only includes year, month, and day"; **
  Timestamp** = "a more granular time value that also includes hours, minutes, seconds"
  (`:8-17`).
- The rule: "**Use timestamps when recording when an action has occurred.** Examples
  include created_at, updated_at... **Use dates when accepting a scheduled date from the
  Prime.** Examples include scheduled move date, scheduled pickup date" (`:32-34`).
- Why it is hard, stated as a worked example: "Is `2020-01-20T16:00:00` more than one day
  after `2020-01-19`?" (`:23`).
- The conversion rule: interpret a date in **Pacific** time; use beginning-of-day or
  end-of-day "depending on operation being performed. In general, use the most forgiving
  interpretation" (`:38-42`).
- Serialization: RFC3339, explicitly preferred over ISO8601 because ISO8601 "contains many
  optional features" (`:46`).
- **Both alternatives were considered and rejected with reasons we should re-examine**:
  storing everything as timestamps ("we would store a time that was the end of the selected
  day for requested pickup date", `:71`), and *recording a time zone for all dates* -
  rejected because "This adds complexity to the Prime API for consumers, as they would need
  to provide a timezone or location for every date" (`:77`).

ADR 0051 forces `date-time` or `date` and bans the invented `datetime` format - a small
but real lesson about vocabularies leaking non-standard types.

### 5. Concurrency, correction and evolution (ADRs 0042, 0049, 0038, 0078; how-to-deprecate)

- **Optimistic locking (0042).** ETag = base64 of `updated_at`, sent as `If-Match`,
  mismatch = `412`. Why not `Last-Modified`: "Different programming languages have
  different default behavior when dealing with timestamps... we don't know what language
  the Prime will build their API client in" - so the version token is made **opaque** on
  purpose: "the client doesn't know they're dealing with a timestamp - they only have to
  worry about storing a string" (`:29-36`). The do-nothing option was rejected partly
  because "since the contractor will be developing an independent system there is a
  greater, uncontrollable risk that they will work with stale data."
- **Child records get their own ETag and their own endpoint (0049).** "the parent and child
  have two different E-tags, and only the parent's E-tag is passed" - so addresses and
  agents are updated through dedicated endpoints rather than bubbling a child's
  `updated_at` up to the parent, which "may have multiple parents and Prime would not
  realize that they have unwittingly updated unrelated records."
- **Soft delete (0038)** driven by retention: "we must be able to access deleted data even
  several years after it's been used in the system", and a hard rule - "soft delete is to
  be treated like a hard delete in the regard that the process should never be reversed or
  that data can be 'un-deleted'."
- **API evolution (how-to-deprecate-endpoints.md).** Additive-first; mark
  `deprecated: true`; prefix the description with `_[Deprecated: sunset on <date>]_`; link
  the replacement; announce with a sunset date, context, alternatives and a contact;
  minimum **one month for internal consumers, three months for external clients, "Bigger
  changes may need significantly more time"** (`:28-32`), and a caveat that for the Prime
  the process "**has not yet been finalized**. In particular, the notice period may need to
  be extended significantly (6-8 months)." Explicitly, the same process governs
  "**Changing the name of an object/changing terminology**" (`:12-13`) - renaming a
  published concept is a breaking change.
- **Versioning (ADR 0078).** SemVer, version in the URL path, and - the interesting
  choice - endpoints are pulled into a new major version **only when they need a breaking
  change**, so v2 may contain one endpoint while everything else stays v1. Cost
  acknowledged: "Could be more confusing for the consumers of our API since not all
  endpoints are on each version." Visible in the captured Swagger: `prime.yaml`'s
  `createMTOShipment` is a `410 Gone` stub pointing at `/prime/v3/createMTOShipment`.

### 6. How work becomes billable (ghc-invoicing.md)

An actor-by-actor walk of the invoicing flow (`:23-64`), including the validation gates
which are stated nowhere else:

- Prime creates a Payment Request "(optionally marked 'final' to indicate no more payments
  due on this Task Order)" containing "a subset of MTO Service Items from a Move", and
  sends a "Proof of Service Document Package".
- MilMove validates: no previous *final* request sent; **TOO has approved the items**
  ("Unapproved service items will not appear on the MTO"); "requested Service Item balances
  have not been covered in other Payment Requests"; params obey validation; "no other
  Payment Requests are open for these service items". Invalid -> rejection to the Prime,
  **End**.
- TIO validates manually that the document package "properly backs up requested Service
  Items"; rejection requires a reason.
- "If last / 'final' Payment Request, mark the Task Order 'complete'. No future Task Orders
  may be sent on this."
- MilMove sends EDI 858 to TPPS via GEX; receives 997 to acknowledge; "If there are
  issues/errors with EDI 858, MilMove receives EDI 824 with a description of the issue."

GEX is defined in `integrations/gex/index.md` as "the DoD's Global Exchange system for
sending data securely with third parties that are outside of the DoD" - a
government-operated VAN between the agency and US Bank's Syncada.

### 7. Roles as permissions, not participation (roles-and-permissions.md)

"Roles are defined by our existing user groups e.g. TIO, TOO, Prime etc."; permissions are
"composed of an `action` and an `object`. Actions are mapped to CRUD actions, and objects
map to database level objects. e.g. `update.move` or `create.serviceItem`"; they are
**additive** across roles; they are declared on the Swagger operation with `x-permissions`.
Note what this means for a domain model: MilMove's "roles" are an *access-control*
construct attached to endpoints, not modelled participation of a party in a shipment.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **MTO (Move Task Order)** | "similar to an order for goods from a contractor... the record of everything that is ordered (approved) for the Prime to do. The Move Task Order contains all the information about shipments, including approved service items, estimated weights, actuals, requested and scheduled move dates" | A1 | `adrs/0055:133-140` |
| **TOO - Task Ordering Officer** | "responsible for generating Task Orders and 'ordering' shipments and service items such as crating, shuttle service and SIT. They are also a check on lines of accounting" | A8 | `adrs/0055:125-128` |
| **PPM - Personally Procured Move** | "When a service member chooses to handle the move on their own." | A2 | `adrs/0055:130-131` |
| **available_to_prime_at** | "a date and time field that indicates when the move is available for the Prime to handle." | A1 | `adrs/0055:73-75` |
| **locator** | "a 6-digit alphanumeric value that is a sharable, human-readable identifier for a move (so it could be disclosed to support staff, for instance)" | A9 | `adrs/0055:57-59` |
| **reference_id** | "A unique identifier for an MTO (which also serves as the prefix for payment request numbers) in `dddd-dddd` format." | A9 | `adrs/0055:84-87` |
| **Logical Object** | The unit of notification: a named group of tables published as one event payload. Five of them. | A4 | `api/docs/push-notifications-to-prime.md:94-104` |
| **Event code** | `Object+verb`, e.g. `PaymentRequest.Create`; a subscription is (event code, subscriber, url, status). | A4 | `push-notifications-to-prime.md:37-38` |
| **Date** vs **Timestamp** | "a time value that only includes year, month, and day" vs one that "also includes hours, minutes, seconds, and smaller units". Dates are what a human chose; timestamps are what the system recorded. | A4/C5 | `adrs/0043:8-21` |
| **audit_history** | Trigger-populated table holding "the who, what, and when" of every change to an audited table. | A6/C7 | `how-to-add-move-history-events.md:5` |
| **event template** | Front-end renderer selected by `(action, eventName, tableName)` that turns an audit row into a human sentence. | A6 | `adrs/0071:31-53`; `how-to-add-move-history-events.md:147-153` |
| **Proof of Service Document Package** | The document bundle the mover sends with a payment request; the TIO checks it "properly backs up requested Service Items". | A6/A7 | `ghc-invoicing.md:29`, `:45` |
| **final (payment request)** | Marks that "no more payments due on this Task Order"; on approval the task order is marked complete and "No future Task Orders may be sent on this." | A7 | `ghc-invoicing.md:26`, `:54-55` |
| **TPPS / GEX / Syncada** | Third Party Payment System; the DoD's Global Exchange used to reach it; US Bank's platform behind it. | A7 | `ghc-invoicing.md:13`, `integrations/gex/index.md` |
| **eTag / If-Match** | Opaque base64 of `updated_at` used for optimistic locking; mismatch returns 412. | C8 | `adrs/0042:29-36` |

## Lifecycles & events

The site adds **two** lifecycle statements the code alone does not give:

1. **Move states for counseling (ADR 0060).** The question was whether service counseling
   needed one new state or two. Chosen: two states plus one timestamp -
   `needs_service_counseling` on submission if the move is routed to counseling, then
   `service_counseling_completed` with `service_counseling_completed_at` when the counselor
   finishes; the alternative (return to `submitted`) was rejected because "We don't get
   into a confusing situation where moving to submitted updates different timestamps"
   (`:26-28`). The deciding criterion is quotable: the chosen option "**more closely matches
   the mental model of the user**". Note also the framing constraint at the top: "it would
   be nice to minimize the impact of this to downstream systems" (`:9`) - adding a state to
   a published vocabulary is treated as an external-consumer event.

2. **The payment-request flow (ghc-invoicing.md:23-64)** - see "How work becomes billable"
   above. This is the only place either source spells out the *validation gates* between
   states rather than just the state names. The state *diagram*, however, is on a Miro
   board we cannot open.

For the event catalog itself the site is the "why" to the code's "what": aggregate-level
grouping, trigger-on-success-only, trigger-failure-is-non-fatal, echo suppression, and
store-then-send by a separate process. All cited in "Model summary" section 2.

## Time, identity, evidence

**Time** - ADR 0043 is the single most transferable artifact in this source. Two
resolutions, chosen by *who asserted the value*: a human picking a day gets a `date`, the
system recording an occurrence gets a `timestamp`. Plus an explicit, written-down rule for
comparing across the two, and an explicit rejection of per-date time zones on the grounds
of API-consumer burden. ADR 0051 keeps the wire formats to `date` and `date-time` only.

**Identity** - ADR 0055 is where the identifier design is argued rather than merely
implemented: a human-shareable `locator` for telephone use, a machine `reference_id` that
is also the payment-number prefix, and the authors' own doubt: "We likely don't need both
`locator` and `reference_id` if these tables merge" - unresolved, kept, and by the time of
the code snapshot both still exist and a third (`shipmentLocator`) has been derived from
the first. A cautionary tale about identifier proliferation.

**Evidence and corrections** - three mechanisms, all documented here:
- `audit_history` for row-level who/what/when, with the honest caveats that system actions
  have a null user and every value is stringified.
- Soft delete (ADR 0038) for retention, one-way by policy.
- The deprecation process as the *correction mechanism for the published vocabulary
  itself* - additive change, sunset dates in the description, notice periods measured in
  months for external consumers, terminology renames treated as breaking.

One gap worth naming: nothing in this site describes how a *wrong fact* (a mis-entered
actual pickup date) is corrected in a way visible to the mover. The webhook stream would
emit another `MTOShipment.Update`; the subscriber cannot tell a correction from a genuine
change.

## Scores

Only areas this source actually addresses are scored. **A3 (trip/stop/assignment), A5
(SIT) and A12 (rating) are not scored** despite the registry entry listing them: the SIT
material is all in the code, not the docs; there is no trip or stop content anywhere; and
`ghc-rate-engine.md` is 19 lines of gated links (see "What we could not read"). Recording
that as "absent from this source" is more useful than a 1.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 3 | 2 | 1 | 3 | 3 | 1 | 2 | C2 = 3 for the MTO definition and the "every service must be ordered" principle (`adrs/0055:133-140`) - a genuine semantic contribution, not a name. C3 = 2: ADR 0060 reasons about states *and* their paired timestamps but only for one transition; no full transition table (it is on an unreadable Miro board). C5 = 3 via ADR 0043 + 0060's state-plus-timestamp rule. C6 = 3 for the locator/reference_id argument (`adrs/0055:44-90`). C4 = 1 - the whole discussion is government contracting. |
| A2 Shipment structure | 1 | 2 | n/a | 1 | n/a | n/a | n/a | 3 | Single contribution: ADR 0067, class-table inheritance for shipment subtypes - a shared `mto_shipments` row plus a per-type child table, chosen over widening the parent because "The `mto_shipments` table has a growing number of fields and it's hard to know which fields are applicable for a given shipment type." C8 = 3: an explicitly-reasoned extension point for future shipment types, with the risk named ("If this new pattern is not utilized elsewhere we may be adding more complexity by introducing another pattern that is only partially used"). |
| A4 Execution events & tracking | 2 | 3 | 2 | 1 | 1 | 3 | 3 | 2 | The reason to read this source. C2 = 3: "logical object", event-code shape, and the granularity trade-off are all *defined*, with the table membership of each object listed (`push-notifications-to-prime.md:86-104`). C7 = 3: trigger-on-success-only, non-fatal trigger failure, source-of-change suppression, and the separate trigger-based audit stream with its stated limitations. C6 = 3: the published id is the aggregate root's, and the published name (`MoveTaskOrder`) was deliberately kept stable when the internal one changed. C1 = 2 and C5 = 1 for the same reason as the code: these are change notifications, not execution events - no operational vocabulary, no ETA, no telemetry, no time semantics beyond "when the row changed". |
| A6 Documents & evidence | 1 | 1 | 1 | 1 | n/a | 1 | 3 | 2 | C7 = 3 on provenance mechanics: DB-trigger audit with session user identity, the null-user-for-system caveat, stringified values, three timestamps; soft delete for multi-year retention, one-way by policy; `(action, eventName, tableName)` as the key that makes a raw change legible. The documents themselves (proof-of-service package) get only a mention in the invoicing flow. |
| A7 Charges & billing hooks | 2 | 2 | 3 | 2 | 1 | 2 | 2 | 1 | C3 = 3: `ghc-invoicing.md:23-64` is an explicit actor-by-actor walk with the validation gates and the two **End** branches spelled out, including the no-double-billing and no-overlapping-request rules and the effect of `final`. C1 held at 2 - rating is entirely gated, so half the area is missing. |
| A9 Identity & cross-references | 2 | 3 | n/a | 1 | n/a | 3 | 2 | 2 | ADR 0055's identifier definitions with stated audiences, plus the unresolved locator-vs-reference_id doubt; ADR 0042's opaque version token, deliberately opaque so a partner in an unknown language cannot mis-parse it; ADR 0049 giving child records their own identity and their own endpoint rather than versioning them through the parent. |

**Cross-cutting C8 note** (applies to whatever we publish, in every area): ADR 0078 plus
`how-to-deprecate-endpoints.md` constitute a usable policy for a versioned public
vocabulary - additive first; version only the endpoints that break; sunset dates written
into the artifact itself; 3+ months notice for external consumers with an admission that
6-8 may be needed; renaming a concept counts as breaking.

**S5 - fit to Pegasus data:**

| Area | pegII | Cloud | Note |
| --- | --- | --- | --- |
| A1 | partial | unknown | The *decisions* transfer regardless of our data; what needs checking is whether pegII has a single "now actionable" marker and whether adding a status is safe for downstream consumers. |
| A2 | n/a | unknown | ADR 0067 is a schema-design pattern for Cloud, not something pegII can "supply". |
| A4 | no | unknown | pegII is form-and-save; there is no event emission to map. The whole point of adopting this source is that we must *build* what it describes. Whether pegII can emit on save at all is the open question. |
| A6 | unknown | unknown | Does pegII have row-level audit with the acting user? If yes, it is a candidate source for a change stream exactly as `audit_history` is here. |
| A7 | partial | unknown | Invoice states probably exist; the validation gates (no double-billing, final closes the order) need checking against pegII behaviour. |
| A9 | partial | unknown | We will have our own numbers; ADR 0055's warning about keeping two identifiers "for now" is the thing to check against pegII. |

## Strengths worth adopting

1. **ADR 0043 wholesale, minus the Pacific rule.** Date for what a human chose, timestamp
   for what the system observed, one written conversion rule, RFC3339 on the wire. Replace
   "interpret in Pacific" with the time zone of the stop - and note that ADR 0043 *already
   considered and rejected* that option, with a reason (consumer burden) we should
   deliberately overrule, not overlook.
2. **Write down the granularity decision, not just its result.** "We do not want to send
   the whole MTO on each event, nor do we want to send a single address record." Our
   catalog should carry the same paragraph, naming the aggregates and their table
   membership, so the next engineer cannot quietly publish at a different level.
3. **One internal event bus, many consumers.** "The event package is generic and services
   all events for all internal and external needs. It will not sanitize or assemble the
   data" - each consumer owns its payload and its suppression rules. This is exactly the
   split we need if pegII, Cloud, Omnitracs, Samsara and a future visibility platform are
   all to be fed from one place.
4. **Trigger on success only; never let notification failure fail the business action.**
   Two one-line rules that decide whether an event catalog is trustworthy.
5. **Store-then-send, asynchronously, "to avoid increasing the time to execute the
   handler."** The reason is stated in terms of the *user's* latency, which is the argument
   that wins with a legacy form-and-save system like pegII.
6. **Keep the published name stable when the internal name changes.** "It is called MtoID
   because we recently consolidated the Move and MTO tables... but Prime understands Move
   Task Order." An event catalog is a contract; refactors must not leak into it.
7. **Run a second, row-level audit stream beside the domain events** - and record its
   limits honestly (null user for system actions, everything stringified). Domain events
   for integration, audit history for "who changed what to what".
8. **Key the human rendering of a change on `(action, eventName, tableName)`,** where
   `eventName` is the *operation* that caused it. The operation name is what makes a diff
   legible; a field-level diff alone is not.
9. **ADR 0071's maintenance lesson**: one module per event with its test beside it, not one
   growing file. Our catalog will have more entries than their 53 - design the repository
   layout for that on day one.
10. **Deprecation as a documented, dated, communicated process**, with terminology renames
    counted as breaking changes and external notice measured in months. Adopt before the
    first event is published, not after.
11. **Make the version token opaque.** ETag = base64 of a timestamp precisely so a partner
    writing in an unknown language cannot mis-parse it. The same reasoning applies to any
    cursor or sequence token we hand Omnitracs or a shipper's platform.
12. **Give child records their own version and their own endpoint** (ADR 0049) rather than
    bubbling `updated_at` up, because "the child may have multiple parents and Prime would
    not realize that they have unwittingly updated unrelated records."
13. **"Every service the mover undertakes must be ordered."** As a design principle for
    charges this is stronger than anything in the tariff sources: no work is billable
    unless an approved line exists for it, and approval is a modelled, dated event.
14. **Pick the state design that "more closely matches the mental model of the user"**
    (ADR 0060) - and treat adding a state as an event affecting downstream systems.

## Weaknesses / traps

1. **Pacific time as the universal interpretation of a bare date.** Fine for one federal
   program; wrong for an interstate mover. See ADR 0043 `:38-42`.
2. **The documented event design is explicitly built for exactly one subscriber.**
   Subscription management endpoints were skipped because "With only one subscriber,
   endpoints for self-service have limited value." Everything downstream of that - no
   self-service, no per-subscriber filtering beyond event key, suppression hardcoded to
   "the Prime API" rather than derived from an actor field - is a shape we must *not*
   inherit, because we will have several subscribers (van line, shipper platform,
   telematics, tenants).
3. **"Every endpoint should have an event trigger" produces a CRUD catalog.** The rule
   guarantees coverage and guarantees the wrong vocabulary: events end up named after
   endpoints and tables rather than after things that happen in the world. Take the
   coverage discipline; derive the names from the domain instead.
4. **Event payloads assembled at trigger time and stored, then sent later.** Combined with
   an async sender, a subscriber can receive a stale snapshot labelled as current. Decide
   consciously between "carry state" and "carry identity, refetch".
5. **The audit stream is keyed on tables, so reconstructing one move's history needs a
   bespoke SQL fetcher** that must be extended, with a hand-built `context` JSON, every
   time a new thing is tracked (`how-to-add-move-history-events.md:56-96`). A change log
   organised around the *aggregate* from the start avoids this.
6. **"Changed data is stored as a JSON string, and to date all data is saved as strings
   regardless of initial data type."** Type information is lost at capture. If we build a
   change stream on triggers, preserve types.
7. **"Events initiated by the system are logged as null users."** A null actor is a
   modelling failure, not an absence - "the nightly job" and "an automated rule" are
   actors. Rubric C7 asks who asserted each fact; `null` never answers it.
8. **The most load-bearing artifacts are unreadable.** The logical-object map is a PNG we
   do not have; the payment-request state machine is a Miro board; the rate engine and the
   EDI 858 field mapping are gated Google Docs. Any claim that MilMove "covers" rating or
   the full payment state machine must be marked unverified.
9. **Military framing throughout** - TOO/TIO/SC, GBLOC, entitlements, lines of accounting,
   TPPS/GEX. Same strip-list as src:milmove-mymove.
10. **ADR 0055 closed off multiple MTOs per move** to simplify one system, while noting an
    MTO "is a legal construct with specific requirements". If our order-to-shipment
    relationship is ever one-to-many (an order served by more than one authorising
    document, or one household served under two accounts), do not copy the merge - copy the
    *argument*, which is "an MTO is essentially a move that is available to the Prime", and
    check that our equivalent holds.
11. **Roles are RBAC, not participation.** `update.move`, `create.serviceItem` are
    endpoint permissions. Do not mistake MilMove's role vocabulary for a party model -
    rubric A8 needs parties with roles *in a shipment*, which this source does not have.
12. **ADR 0071 is a front-end file-organisation decision** despite its promising title; it
    contributes the template-key idea and a maintenance warning, nothing about domain event
    semantics. Do not cite it as an event-modelling authority.
13. **Documentation drift is visible in the capture**: ADR 0078 is superseded by 0080;
    `Event` struct shown in `push-notifications-to-prime.md:56-65` still has
    `Request *http.Request`, `DBConnection` and `logger` fields that the code has since
    replaced with a single `AppContext`. Prefer the code where they disagree.

## Out-of-v1 material

- **A12 rating & tariffs - the biggest known gap.** `ghc-rate-engine.md` names, without
  content, the artifacts that would matter: a "current pricing template", "what inputs are
  needed for pricing service items", "Service Item Codes", "how to price a service item",
  and "Research versioning of rate engine tables". All Google Docs/Sheets. Companion
  pricing-import guides exist in the capture but were **not read** -
  `ghc-pricing-import.md`, `ghc-pricing-parser.md`, `ghc-import-pricing-production.md`,
  `ghc-transit-time-import.md`, `zip-code-to-rate-area-mappings.md`,
  `tspp-data-creation.md`. If phase 3 needs a rating source and the 400NG tariff proves
  insufficient, these are the next files to read, not the ADRs.
- **A11 claims** - nothing.
- **A13 crew/driver/settlement** - nothing.
- **A10 survey/inventory** - nothing.
- **Distance as an external service** (`backend/guides/route-planner.md`): distance is
  computed by a pluggable `RoutePlanner` interface - `TransitDistance(source, destination
  *models.Address)`, `LatLongTransitDistance`, `Zip5TransitDistance`, `Zip3TransitDistance`
  - backed by the HERE API, with geocoding to lat/long in between. Two notes for us: the
  *granularity of the distance question* (address / lat-long / zip5 / zip3) is itself
  modelled, and zip3-vs-zip5 matters because "Shipments that start and end in one ZIP3 use
  Short Haul pricing" (per the Prime API). Also `integrations/dtod/` (DoD Table of
  Distances) - not read.
- **Reconciliation**: `acceptance-testing-syncada-edi-invoicing.md` and the TPPS paid
  invoice report - the loop that closes payment back against the request - not read.

## Open questions

1. **Can pegII emit on save at all?** MilMove's rule is "every endpoint triggers an event
   in the top-level handler." pegII is form-and-save with no handler layer to hook. Is
   there a trigger/CDC route (the `audit_history` pattern) or must emission be bolted to
   the save path? This is the single biggest unknown standing between us and a catalog.
2. **How many subscribers will we really have, and do they need self-service
   subscriptions?** MilMove skipped subscription management because it had one subscriber.
   With Allied and Atlas tenants, Omnitracs, Samsara and a possible future visibility
   platform, the answer is probably different - and it changes the design now, not later.
3. **Echo suppression when the actor is not an API caller.** MilMove derives "who caused
   this" from which API the endpoint belonged to. If a change arrives from a telematics
   feed, a batch import or a human in a legacy form, what is the actor and where is it
   recorded? Suppression and provenance both depend on answering this.
4. **Snapshot or pointer in the event payload?** Needs deciding before publication; see
   trap 4.
5. **What is our notice period for changing the catalog,** and where is the deprecation
   marker written so a partner sees it? MilMove puts it in the endpoint description and a
   Slack announcement. We have no Slack with Allied's integration team.
6. **Do we need MilMove's `since`-polling fallback beside push?** `listMoves?since=` exists
   alongside the webhooks. Two mechanisms, twice the surface - but it is what lets a
   partner recover from an outage without replay.
7. **Should our change stream be trigger-based (like `audit_history`) or
   application-level (like their event package), or both?** MilMove ended up with both, for
   different consumers, apparently without planning to. Deciding deliberately is cheaper.
8. **Rating source.** Since the rate engine is unreadable here, confirm that src:dp3-400ng
   (or another tariff source) can carry A12, or schedule the pricing-import guides above
   for a later read.
