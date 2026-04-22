# Document Variants — Hybrid Derived-Asset Cache

## Goal

Drivers and carriers upload documents in whatever format their device
produces (iPhone HEIC, Android JPEG, scanner PDF, oversized phone photos).
Today the API stores the original in S3 and serves it back as-is, which
means browsers can't display HEIC at all, and full-size originals burn
bandwidth on every list/thumbnail render.

After this plan, every uploaded document gets two pre-generated variants
at ingest time — `thumb` (~400px longest edge) and `web` (~2000px longest
edge) — stored alongside the original in S3 and tracked in a new
`DocumentVariant` table. The existing download-url endpoint learns a
`?variant=` query param and transparently falls back to the original when
a variant is still pending or permanently unavailable.

Originals are never mutated, never transcoded in place, and never deleted
by this feature. Conversion runs in a dedicated Lambda triggered by the
S3 `ObjectCreated` event on the originals prefix, so the API Lambda stays
lean and conversions retry for free.

## Non-goals (YAGNI)

Explicitly **out of scope** — revisit only when a concrete feature asks:

- OCR'd / searchable PDFs
- Watermarked delivery copies
- Print-resolution variant
- Content-addressed dedup keys
- CloudFront in front of the derived assets
- Backfill job for documents that predate this feature
- Virus scanning, EXIF stripping
- Glacier lifecycle rules on originals
- A generic "request any variant on demand" lazy-generation path
  (the hybrid plan allowed it; in practice the eager set covers every
  screen we have today, so we're not building the lazy path yet)

## Current state (what exists)

- `Document` model (`apps/api/prisma/schema.prisma:934`) — polymorphic
  row with `s3Bucket` / `s3Key` / `mimeType` / `sizeBytes` / `status`
  state machine (`PENDING_UPLOAD → ACTIVE → …`).
- Handler `apps/api/src/handlers/documents.ts` — upload-url, finalize,
  download-url, list by entity, get, delete, archive.
- S3 helpers `apps/api/src/lib/documents-s3.ts` — `buildS3Key`,
  `presignUpload`, `presignDownload`.
- Infra `packages/infra/lib/stacks/documents-stack.ts` — the documents
  bucket itself (already deployed).
- Repository `apps/api/src/repositories/document.repository.ts`.
- Mime allowlist: `image/*`, `application/pdf`, MS Office, `text/*`.
  **HEIC is not currently allowed** — it must be added.

## Design

### Storage layout

One bucket, two prefixes under each document:

```
{tenantId}/{entityType}/{entityId}/{documentId}/
    original/{sanitized-filename}
    variants/thumb.jpg
    variants/web.jpg
```

Originals move from the flat layout (`.../{docId}/{filename}`) to
`.../{docId}/original/{filename}`. This is a breaking key change for
existing rows — acceptable because the documents feature is new and no
production tenants depend on the old keys. A data migration renames
existing keys in place via S3 `CopyObject` + `DeleteObject`, driven by
a one-shot script run as part of the deploy (see plan step 9).

### `DocumentVariant` table

```prisma
model DocumentVariant {
  id          String                @id @default(uuid())
  documentId  String                @map("document_id")
  variant     DocumentVariantKind   // THUMB | WEB
  status      DocumentVariantStatus // PENDING | READY | FAILED
  s3Key       String?               @map("s3_key")    // set when READY
  sizeBytes   Int?                  @map("size_bytes")
  width       Int?
  height      Int?
  failureReason String?             @map("failure_reason")
  generatedAt DateTime?             @map("generated_at")
  createdAt   DateTime              @default(now()) @map("created_at")
  updatedAt   DateTime              @updatedAt      @map("updated_at")

  document    Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([documentId, variant])
  @@index([status])
  @@schema("public")
  @@map("document_variants")
}
```

The unique constraint on `(documentId, variant)` is the whole
concurrency story: the conversion Lambda upserts, so re-delivery of
an S3 event is idempotent.

### Conversion Lambda

New Lambda `apps/api/src/lambda-document-converter.ts` (separate bundle
from the API Lambda, separate CDK function in `DocumentsStack`).

- **Trigger:** S3 `ObjectCreated:*` event on prefix `*/original/`
- **Runtime deps:** `sharp` (images) and `pdfjs-dist` +
  `@napi-rs/canvas` (PDF first-page render). Bundled via esbuild with
  `nodejs20.x` and the sharp prebuilt for `linux-x64` as a Lambda layer
  — see PATTERNS.md after implementation for the bundling recipe.
- **Flow per event:**
  1. Parse bucket/key, look up `Document` by s3Key.
     - If missing (race with a deleted row), log WARN and return.
  2. For each variant in `[THUMB, WEB]`:
     - Upsert `DocumentVariant` row with status `PENDING`.
     - Download original from S3.
     - Transcode:
       - Images (incl. HEIC/HEIF) → sharp resize + JPEG encode
       - PDF → pdfjs renders page 1 to canvas → PNG → sharp resize + JPEG
       - MS Office / text → skip (no variant row written; see "Skipped
         types" below).
     - Upload to `variants/{kind}.jpg`.
     - Update variant row: `status=READY`, fill `s3Key`, `sizeBytes`,
       `width`, `height`, `generatedAt`.
  3. On transcode failure: mark variant `FAILED` with `failureReason`;
     do not throw (S3 retry is not useful — the file isn't going to
     become decodable).
  4. On infra failure (S3 read/write, DB): throw so S3 retries.
- **Skipped types:** MS Office and plain text produce no variants. The
  download-url endpoint falls back to the original for these — same
  behavior as today.

### API changes

`GET /api/v1/documents/:id/download-url?variant=thumb|web|original`

- Default (no param) → original (unchanged behavior).
- `variant=original` → explicit original.
- `variant=thumb|web`:
  - If variant row exists and `status=READY` → presigned GET to variant key.
  - If variant row exists and `status=PENDING` → presigned GET to
    original, response includes `variantStatus: 'pending'`.
  - If variant row exists and `status=FAILED`, or no row (skipped type) →
    presigned GET to original, response includes `variantStatus: 'unavailable'`.

Response shape extends the existing one:

```ts
{
  data: {
    downloadUrl: string
    expiresInSeconds: number
    variant: 'thumb' | 'web' | 'original'
    variantStatus?: 'pending' | 'unavailable' // absent on success
  }
}
```

List endpoint (`GET /entity/:type/:id`) gains a `variants` field per
document: `{ thumb: 'ready'|'pending'|'failed'|'none', web: ... }` so
the frontend can decide whether to render a thumbnail URL immediately
or poll.

### HEIC support

Add `image/heic` and `image/heif` to `ALLOWED_MIME_PREFIXES` in
`apps/api/src/handlers/documents.ts`. No client-side handling needed —
the variant cache hides HEIC from the browser entirely.

## Plan

- [x] **1. DECISIONS.md note on the variant strategy.**
      Short entry capturing: separate `DocumentVariant` table (not JSON),
      eager pair (`thumb` + `web`), event-driven conversion Lambda,
      `?variant=` query param with transparent fallback.

- [x] **2. Prisma schema + migration.**
      Add `DocumentVariantKind`, `DocumentVariantStatus` enums and
      `DocumentVariant` model. Generate migration via
      `prisma migrate diff --from-empty --to-schema-datamodel` per the
      Prisma Setup memory. No data backfill in this migration — a
      separate script handles key renames (step 9).

- [x] **3. Repository layer.**
      `apps/api/src/repositories/document-variant.repository.ts`:
      `upsertPendingVariant`, `markVariantReady`, `markVariantFailed`,
      `findVariantsForDocument`, `findReadyVariant`. Integration tests
      guarded by `describe.skipIf(!process.env['DATABASE_URL'])`.

- [x] **4. Handler changes.** - Add HEIC/HEIF to mime allowlist. - Extend `GET /:id/download-url` with `variant` query param and
      fallback logic above. - Extend `GET /entity/:type/:id` list response to include
      per-document variant status map. - Unit tests for the fallback matrix (ready / pending / failed /
      skipped type / unknown variant name).

- [x] **5. S3 key layout change.**
      Update `buildS3Key` to emit `.../{documentId}/original/{filename}`.
      Update `presignUpload` call site to pass the new key. Update the
      variant writer to use `.../{documentId}/variants/{kind}.jpg`.
      Add `buildVariantS3Key` helper.

- [x] **6. Conversion Lambda — handler + transcoders.**
      `apps/api/src/lambda-document-converter.ts` entry point, plus
      `apps/api/src/lib/document-transcode.ts` with pure functions
      (`transcodeImage`, `transcodePdfFirstPage`) that take a Buffer
      and return `{ buffer, width, height }`. Pure transcoders stay
      unit-testable without S3 mocks.

- [x] **7. CDK — wire the converter Lambda.**
      In `packages/infra/lib/stacks/documents-stack.ts`: - New `NodejsFunction` with sharp layer and `pdfjs-dist` bundled. - `bucket.addEventNotification(EventType.OBJECT_CREATED,
    new LambdaDestination(fn), { prefix: '...', suffix: '' })` —
      filter on `original/` somewhere in the key. If S3 prefix
      filters can't match a mid-key segment, filter in the Lambda
      instead and document why in a one-line code comment. - Grant Lambda `s3:GetObject` on originals, `s3:PutObject` on
      variants, DB Proxy connect, secret read. Reuse the same DB
      connection pattern as the API Lambda. - Explicit `logs.LogGroup` (never `logRetention`, per memory). - CDK snapshot + assertion tests updated.

- [x] **8. OpenAPI spec.**
      Update `apps/api/src/lib/openapi-spec.ts` for the new query
      param, extended response shape, and HEIC mime types. Existing
      `apps/api/src/__tests__/openapi.test.ts` should still pass.

- [x] **9. One-shot migration script for existing keys.**
      `apps/api/scripts/migrate-document-keys.ts` — for every
      `Document` row, `CopyObject` the current key to the new
      `original/` layout and update `s3Key` in the DB. Dry-run mode
      by default. Idempotent: skips rows already under `original/`.
      Runs manually post-deploy; not part of the CDK deploy.

- [x] **10. E2E spec.**
      `apps/e2e/tests/api/documents-variants.spec.ts`:
      upload a small JPEG via the presigned URL, finalize, poll
      the list endpoint until `variants.thumb === 'ready'`, fetch
      `download-url?variant=thumb`, HEAD the presigned URL and
      assert `content-type: image/jpeg` and `content-length` below
      the original. Use a tiny fixture image checked into
      `apps/e2e/fixtures/`.

- [x] **11. Docs — PATTERNS.md + GOTCHAS.md.**
      PATTERNS.md: the variant lifecycle, idempotent upsert pattern,
      pure transcoder + thin Lambda handler split, `?variant=` fallback
      contract.
      GOTCHAS.md: sharp bundling for Lambda (layer vs. bundled binary),
      pdfjs needing a canvas polyfill in Node, S3 event prefix filter
      limitations.

- [x] **12. Merge + full test sweep.**
      Merged to main (commits `c4e06ad`, `96329a5`, `537ba99`). Post-merge
      sweep: `npm run typecheck`, `npm run lint`, `npm test` all green
      across 13 packages / 868 API tests (including
      `lambda-document-converter.test.ts`). E2E suite loaded all 32 specs
      including `documents-variants.spec.ts`; gracefully skipped in
      environments without Docker/Postgres per documented behavior.

## Risks / open questions

- **Sharp in Lambda bundle size.** Sharp's prebuilt binary plus pdfjs
  pushes the converter bundle well past the 50MB inline zip limit. A
  Lambda Layer for sharp is the idiomatic fix; plan step 7 assumes
  that. If the layer approach fights the existing CDK NodejsFunction
  bundling, the fallback is a container-image Lambda for the converter
  only — revisit in step 7 if bundling fails.
- **PDF rendering fidelity.** pdfjs renders in JS without a headless
  browser, so exotic PDFs (scanned, password-protected, malformed)
  will fail transcode. That's fine — they get `FAILED` variants and
  fall back to the original, which is exactly the behavior we want.
- **S3 event replay / duplicate delivery.** Handled by the
  `(documentId, variant)` unique constraint + upsert. Safe to retry.
- **Originals bucket growth.** Not addressing in this plan. Lifecycle
  rules are called out in non-goals and can be added when storage cost
  becomes measurable.
