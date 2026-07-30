# Feedback Requests — tenant-authored surveys via magic-link forms

## Context

The customer wants to solicit feedback from customers/drivers via text (later email),
capture the response, and _do something with it_ (route it into their automation). This
maps cleanly onto Pegasus' DIY-automation theme: the tenant authors a form as a
declarative, versioned artifact through the SDK, the platform mints a per-recipient
tokenized link, and a submitted response lands as a **DomainEvent** that the existing
workflow-trigger dispatcher fires the tenant's Python workflow off of.

**Terminology note that shaped this design:** in AWS, "pre-signed URL" means signed S3
object access (this repo already has that for documents/blobs). What's actually wanted is
a **capability URL / magic link** — a tokenized, expiring, per-recipient link to a _form_.
Different mechanism; this plan builds the latter and reuses the former only for the
optional photo-attachment extension.

**Decisions locked with the user:**

- Link target: **Pegasus-hosted form**, rendered generically from a tenant-authored definition.
- Authoring: **SDK/CLI** (mirror `integration-config`), plus a **read-only tenant-web viewer**.
- Delivery: **mint-only primitive first**, with mint-and-send SMS as sugar over it.
- Channels: **SMS only for v1** (RingCentral, already wired). Email deferred (no generic SES send exists today).

The single biggest win: **"parse the feedback and do something with it" is already solved.**
`ingress.ts` proves the pattern — `emitTenantEvent` → `DomainEvent` outbox →
`lambda-dispatch-workflow-triggers.ts` → tenant workflow, described in-code as "no new
dispatch path." We reuse it verbatim.

---

## Architecture (flow)

```
AUTHOR (SDK)                MINT (workflow/API)         RESPOND (public)             AUTOMATE (existing)
feedback-form.json   ──▶    POST /feedback-requests ──▶ GET  /public/v1/feedback/:tok ──▶ emitTenantEvent
 validate / publish         → { url, expiresAt }        (renders form definition)         → DomainEvent
 versions / rollback        (opt: channel=sms → sendSms)POST /public/v1/feedback/:tok      "feedback.submitted"
      │                            │                     (validate + record + emit)         → dispatcher
   read-only viewer          send_sms() [EXISTS]         single-submit dedup                → tenant workflow
   in tenant-web             url = {TENANT_WEB}/f/:tok   [EXISTS: emitTenantEvent]          [EXISTS]
```

Public form page = a **new public SPA route `/f/:token`** in tenant-web (like `landing`/`login`).
The SPA's CloudFront 403/404→`index.html` fallback already deep-links it — **no new infra.**
It fetches the definition from the public GET, renders from question types, POSTs the answer.

---

## What already exists (reuse — do not rebuild)

| Need                                                                  | Reuse                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Public, tenant-resolving endpoint w/ opaque bearer + timing-safe hash | `handlers/ingress.ts` + `IngressCredential` (sha256 + 12-char prefix index)                                                     |
| Response → workflow                                                   | `emitTenantEvent` (`lib/domain-events.ts`) → `DomainEvent` → `lambda-dispatch-workflow-triggers.ts`                             |
| Versioned publish / versions / rollback lifecycle                     | `handlers/integration-validation/config.ts` + its repository + `IntegrationConfig` model                                        |
| Definition + response validation                                      | `lib/payload-schema-validator.ts` (`validatePayloadSchema` at publish, `validatePayload` at submit)                             |
| Outbound SMS (the sugar path)                                         | `services/ringcentral/sms.ts` `sendSms` + `repositories/messaging.repository` `listConnectionsByTenant` (see `handlers/sms.ts`) |
| Feature gate that 404s the whole surface                              | `lib/custom-events-feature.ts` pattern (`FEEDBACK_ENABLED`)                                                                     |
| SDK CLI author workflow (validate/publish/pull/versions/rollback)     | `cli/integration_config.py`                                                                                                     |
| Optional photo upload (real S3 presign)                               | `lib/documents-s3.ts` `presignUpload` + `handlers/blobs.ts`                                                                     |

---

## Build

### 1. Data model — `apps/api/prisma/schema.prisma`

Two new models (mirror the shapes cited above):

- **`FeedbackForm`** — `(tenantId, formKey, version)` unique, `status` PUBLISHED/SUPERSEDED,
  `definition Json` (questions: id/type/label/required/constraints), `messageTemplate String?`,
  `publishedBy`, timestamps. Immutable versions; publish supersedes prior PUBLISHED (copy
  `IntegrationConfig` semantics).
- **`FeedbackRequest`** — `id`, `tokenPrefix` + `tokenHash` (copy `IngressCredential`),
  `formKey` + `formVersion` (pinned at mint), `subjectType`/`subjectId` (opaque correlation,
  e.g. `move`/`customer`/`driver`), `status` PENDING/SUBMITTED/EXPIRED, `expiresAt`,
  `respondedAt?`, `responsePayload Json?`. Unique on `tokenPrefix`-indexed lookup; single
  submit enforced by `status`.

Run `db:migrate` + `db:generate` after (per `[[project_worktree_stale_prisma_client]]`).

### 2. Repositories & shared token helper

- `repositories/feedback-form.repository.ts`, `repositories/feedback-request.repository.ts`.
- Extract the opaque-token mint/hash/compare out of `ingress.ts` into `lib/opaque-token.ts`
  and have both ingress and feedback use it (small refactor; keeps timing-safe compare in one place).

### 3. Cedar actions — `apps/api/src/authz/actions.ts`

- `ManageFeedbackForms` (author), `ReadFeedbackForms` (viewer), `CreateFeedbackRequest`
  (granted to `workflow_runtime`, exactly like `SendSms`). Public endpoints are **unauthenticated**
  (token in path), so no action.

### 4. Handlers

- **`handlers/feedback-forms.ts`** — dual-auth, mirror `integration-validation/config.ts`:
  `POST /:key/validate`, `POST /:key/publish`, `GET /`, `GET /:key`, `GET /:key/versions`,
  `POST /:key/rollback`. Mount on `m2mV1` at `/feedback-forms` (`app.ts`).
- **`handlers/feedback-requests.ts`** — dual-auth: `POST /` (mint → `{requestId,url,expiresAt}`;
  optional `channel:"sms"`+`to` renders `messageTemplate` and calls `sendSms` inline),
  `GET /:id` (status read). Mount at `/feedback-requests`.
- **`handlers/feedback-public.ts`** — **pre-tenant** (mirror `ingressHandler`, resolves tenant
  from token): `GET /feedback/:token` (return pinned definition; **no subject PII**),
  `POST /feedback/:token` (validate against definition via `validatePayload`; record on the
  request row; `emitTenantEvent('feedback.submitted', {...})` in one transaction; single-submit
  dedup like ingress; return thank-you ack). Mount `app.route('/api/public/v1', feedbackPublicHandler)`
  **before** the tenant block.
- Feature-gate every route behind `FEEDBACK_ENABLED` (copy `custom-events-feature.ts`).

### 5. Event type — `lib/domain-events.ts`

Add built-in `feedback.submitted` to `DOMAIN_EVENT_TYPES` so a workflow **EVENT** trigger
subscribes to it and v2 dot-path filters can match on `formKey` / `subject.type`. Payload:
`{ requestId, formKey, subject:{type,id}, response }`.

### 6. Public form page — `apps/tenant-web`

New **public** route `/f/:token` (register in `router.tsx` alongside `landing`/`login`; no auth guard).
Generic renderer over question types (rating/text/select/boolean); on submit POSTs to the public API.
Read-only **viewer** under settings (mirror `/integrations` + `settings.workflows`): **v1 lists
published forms + versions only** — per-request/response status listing is deferred (responses are
already visible via the tenant's own workflow). `url` returned at mint = `{TENANT_WEB_PUBLIC_URL}/f/<token>`.

### 7. SDK + discovery surfaces — `packages/workflows-sdk-python`

- `api.py`: `create_feedback_request(form_key, subject_type, subject_id, ttl_hours, channel=None, to=None)`
  and `get_feedback_request(request_id)`. (Writes need a typed method — no generic write passthrough,
  per `[[feedback_sdk_selfserve_discoverability]]`.)
- New CLI group `cli/feedback_form.py` (mirror `integration_config.py`): `validate` / `publish` /
  `pull` / `versions` / `rollback`; working-dir files `form.json` + optional `message.txt`.
- **Register the new mutations in `testing/__init__.py` `_MUTATIONS` + `_MUTATION_CALLS`** (parity list,
  per `[[project_integration_config_delete]]`).
- Update discovery: SDK README, `pegasus-workflows` CLAUDE.md, MCP resources (`pegasus://reference/*`),
  and **OpenAPI** (`lib/openapi-spec.ts` — the coverage test fails CI on an undocumented m2m route,
  per `[[project_sdk_discoverability_punchlist]]`). Publish SDK by pushing the `sdk-python-v<ver>` tag
  (per `[[feedback_no_publish_from_platform_session]]`).

### Optional extension (note, not v1)

Photo answers → the **genuine** presigned-URL use: public `GET /feedback/:token/upload-url` mints a
`presignUpload` PUT into the documents/blobs bucket keyed by `requestId`. Left out of v1 to keep scope tight.

---

## Security notes

- Token: 32-byte base64url, `sha256`+prefix stored, timing-safe compare (reuse ingress helper). Expiry + single-submit enforced server-side.
- Public POST is token-in-path with no cookies/session ⇒ not CSRF-susceptible.
- Public GET returns only the form definition (+ optional greeting) — never subject PII; the message template is rendered **at mint time**, never exposed on the public GET.
- `FEEDBACK_ENABLED` off by default ⇒ surface does not exist until ops flips it.

## Verification

- **Unit** (`packages/domain` / api libs): definition validator + response validator (`payload-schema-validator`), token mint/compare, template rendering.
- **Integration** (`apps/api`, skips when `DATABASE_URL` unset): publish→version→rollback; mint→`{url}`; public GET returns pinned definition; public POST validates + records + emits exactly one `DomainEvent` + single-submit dedup returns the same ack without re-emitting; feature-gate 404s when off.
- **SDK** (`pytest`): `create_feedback_request` / `get_feedback_request`; `_MUTATIONS`/`_MUTATION_CALLS` parity; CLI validate/publish round-trip. `openapi-spec.coverage.test.ts` green.
- **E2E** (`apps/e2e/tests/api`): mint → open `/f/:token` → submit → assert the tenant workflow's EVENT trigger fired (execution row appears).
- **Manual dry-run**: publish a form via CLI, mint a request, `curl` the public GET/POST, confirm the `feedback.submitted` event + workflow execution.
