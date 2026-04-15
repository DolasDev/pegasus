# Document Management System

## Goal

Add first-class document storage to Pegasus so any entity in any bounded
context (Customer, Quote, Move, Invoice, …) can attach uploaded files
(contracts, photos, signed BOLs, receipts). Files live in S3; metadata lives
in Postgres under the tenant-scoped `public` schema.

## Scope & Non-Goals

**In scope**

- `Document` table + `DocumentStatus` enum, migration, repository, handler.
- Presigned PUT/GET URL generation via AWS SDK v3.
- New CDK `DocumentsStack` (S3 bucket) wired into `ApiStack`.
- Unit tests for the repository and handler.

**Out of scope (separate plans)**

- Virus scanning / ClamAV Lambda.
- Background hard-delete worker that purges `PENDING_DELETION` S3 objects.
- Frontend upload UI in `tenant-web`.
- Image thumbnailing / OCR.

## Why This Plan Departs From the Original Prompt

The seed prompt was generic. Pegasus has strong conventions that must be
respected. The rewrite below applies them:

1. **Namespace** — there is no `Pegasus.MoveManager` namespace; Pegasus is a
   TypeScript monorepo. Removed.
2. **Paths** — `src/services/` and `src/routes/` don't exist. Handlers live in
   `apps/api/src/handlers/`, DB access in `apps/api/src/repositories/`, and
   small lib helpers in `apps/api/src/lib/`.
3. **Route prefix** — all tenant routes are mounted under `/api/v1` behind
   `tenantMiddleware`. There is no `/api/documents`.
4. **tenantId source** — never read from the body. `tenantMiddleware` already
   provides a tenant-scoped Prisma client via `c.get('db')` that
   automatically filters every query by tenant. Use it; don't re-implement
   scoping.
5. **No handler try/catch** — project rule (see
   `feedback_no_handler_try_catch`). Errors bubble to `app.onError` which
   already knows how to render `DomainError`.
6. **Response shape** — `{ data }` / `{ data, meta }` for success,
   `{ error, code }` for failure. 404s use `code: 'NOT_FOUND'`, validation
   uses `code: 'VALIDATION_ERROR'`.
7. **Prisma conventions** — every public-schema model needs
   `@@schema("public")`, `@map("tenant_id")` on columns, and `@@index`es
   consistent with other tenant tables.
8. **Migration naming** — timestamped, e.g.
   `20260414120000_add_documents`.
9. **Upload state machine** — the original plan creates the `Document` row
   as `ACTIVE` _before_ the file is actually in S3. That's a lie: clients
   can abandon the PUT and leave phantom rows. Fixed below with a
   `PENDING_UPLOAD → ACTIVE` transition driven by an explicit
   `finalize` call.
10. **Infra isolation** — S3 resources go in a new `DocumentsStack`, not
    sprinkled into `ApiStack`. `ApiStack` receives the bucket as a prop;
    this mirrors how `DatabaseStack` hands a SG to `ApiStack`.

---

## 1. Prisma Schema (`apps/api/prisma/schema.prisma`)

Add to the `public` schema section:

```prisma
enum DocumentStatus {
  PENDING_UPLOAD    // row created, presigned PUT issued, file not yet confirmed
  ACTIVE            // upload finalized
  ARCHIVED          // hidden from default lists, still retrievable
  PENDING_DELETION  // soft-deleted; S3 object still present, purged by worker

  @@schema("public")
}

model Document {
  id           String         @id @default(uuid())
  tenantId     String         @map("tenant_id")

  // Polymorphic back-reference. Not a FK — entity tables live in many
  // bounded contexts. Tenant scoping keeps lookups cheap.
  entityType   String         @map("entity_type")  // 'customer' | 'quote' | 'move' | 'invoice' | ...
  entityId     String         @map("entity_id")

  documentType String         @map("document_type") // 'contract' | 'photo' | 'bol' | 'receipt' | ...
  category     String?

  s3Bucket     String         @map("s3_bucket")
  s3Key        String         @map("s3_key")
  filename     String
  mimeType     String         @map("mime_type")
  sizeBytes    Int            @map("size_bytes")

  status       DocumentStatus @default(PENDING_UPLOAD)
  uploadedBy   String         @map("uploaded_by")      // TenantUser.id
  expiresAt    DateTime?      @map("expires_at")
  deletedAt    DateTime?      @map("deleted_at")

  createdAt    DateTime       @default(now()) @map("created_at")
  updatedAt    DateTime       @updatedAt      @map("updated_at")

  tenant       Tenant         @relation(fields: [tenantId], references: [id])

  @@index([tenantId, entityType, entityId])
  @@index([tenantId, documentType])
  @@index([tenantId, status])
  @@schema("public")
  @@map("documents")
}
```

Add `documents Document[]` back-relation on `Tenant` (to match existing
pattern on other tenant-scoped models).

**Migration**

Generate with:

```
node node_modules/.bin/prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260414120000_add_documents/migration.sql
```

(The repo conventionally hand-authors migration SQL — see existing
`20260406000000_add_tenant_id_to_core_tables`.)

---

## 2. Domain Types (`packages/domain/src/document/index.ts`)

Pure TS, zero runtime deps. New bounded context module:

```ts
import type { Brand } from '../shared/types'

export type DocumentId = Brand<string, 'DocumentId'>
export const toDocumentId = (v: string): DocumentId => v as DocumentId

export type DocumentStatus = 'PENDING_UPLOAD' | 'ACTIVE' | 'ARCHIVED' | 'PENDING_DELETION'

export interface Document {
  id: DocumentId
  entityType: string
  entityId: string
  documentType: string
  filename: string
  mimeType: string
  sizeBytes: number
  status: DocumentStatus
  uploadedBy: string
  createdAt: Date
  updatedAt: Date
  category?: string
  expiresAt?: Date
}
```

Notice: **no `s3Bucket` / `s3Key` on the domain type.** Those are
infrastructure and must never leak past the repository layer.

Barrel re-export in `packages/domain/src/index.ts`.

---

## 3. Repository (`apps/api/src/repositories/document.repository.ts`)

Follows the existing repository pattern (see `customer.repository.ts`):
Prisma in, domain types out, mapper strips S3 fields.

Functions:

- `createPendingDocument(db, input): Promise<{ document: Document, s3Key: string, s3Bucket: string }>`
  — writes row with `status: PENDING_UPLOAD`, returns row **plus raw S3
  location** so the handler can hand it to the signer. This is the _only_
  function that returns raw S3 coordinates, and only to in-process callers.
- `finalizeDocument(db, id): Promise<Document | null>` — flips
  `PENDING_UPLOAD → ACTIVE`. Returns null if not found.
- `findDocumentById(db, id): Promise<{ document: Document, s3Key: string, s3Bucket: string } | null>`
  — internal-use variant that returns S3 coords for the download URL
  generator.
- `findDocumentByIdPublic(db, id): Promise<Document | null>` — safe variant
  used by list/get responses.
- `listDocumentsForEntity(db, entityType, entityId): Promise<Document[]>`
  — filters `status = ACTIVE`, sorts `createdAt desc`.
- `softDeleteDocument(db, id): Promise<Document | null>` — sets status
  `PENDING_DELETION`, `deletedAt = now()`.
- `archiveDocument(db, id): Promise<Document | null>` — sets status
  `ARCHIVED`.

All functions receive the **tenant-scoped** `db` from `c.get('db')`, which
applies `WHERE tenant_id = <current>` automatically. Do not re-pass
`tenantId`. Export from `apps/api/src/repositories/index.ts`.

---

## 4. S3 URL Helper (`apps/api/src/lib/documents-s3.ts`)

Thin module, not a class. Two pure functions:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const bucket = () => {
  const name = process.env['DOCUMENTS_BUCKET_NAME']
  if (!name) throw new Error('DOCUMENTS_BUCKET_NAME environment variable is not set')
  return name
}

let _client: S3Client | null = null
const client = () => (_client ??= new S3Client({}))

export function buildS3Key(opts: {
  tenantId: string
  entityType: string
  entityId: string
  documentId: string
  filename: string
}): string {
  const safe = opts.filename.replace(/[^\w.\-]/g, '_')
  return `${opts.tenantId}/${opts.entityType}/${opts.entityId}/${opts.documentId}/${safe}`
}

export async function presignUpload(args: {
  key: string
  mimeType: string
  sizeBytes: number
}): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: args.key,
      ContentType: args.mimeType,
      ContentLength: args.sizeBytes,
    }),
    { expiresIn: 15 * 60 }, // 15 min
  )
}

export async function presignDownload(key: string): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: 5 * 60,
  })
}

export const documentsBucketName = bucket
```

- Singleton client so Lambda cold-starts don't re-instantiate per request.
- Filename sanitized before it enters the S3 key to prevent path traversal
  / control chars.
- `ContentLength` baked into the signature locks the upload size — client
  cannot PUT a 2 GB file after getting a signature for 2 MB.
- **Every handler must treat `s3Key` values as internal-only** and never put
  them in the response body.

Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to
`apps/api/package.json` (`@aws-sdk/*` is already externalized in the CDK
bundle config, so no bundler changes needed).

---

## 5. Handler (`apps/api/src/handlers/documents.ts`)

No try/catch anywhere — let `app.onError` handle it.

Mount in `apps/api/src/app.ts` under the existing `v1` router:

```ts
v1.route('/documents', documentsHandler)
```

**Validation constants (top of file):**

```ts
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.',
  'text/',
]
const ALLOWED_ENTITY_TYPES = new Set(['customer', 'quote', 'move', 'invoice'])
```

**Routes:**

| Method | Path                                             | Purpose                                    |
| ------ | ------------------------------------------------ | ------------------------------------------ |
| POST   | `/api/v1/documents/upload-url`                   | Reserve row (PENDING_UPLOAD) + presign PUT |
| POST   | `/api/v1/documents/:documentId/finalize`         | Mark ACTIVE after client confirms upload   |
| GET    | `/api/v1/documents/:documentId/download-url`     | Presign GET (only if ACTIVE)               |
| GET    | `/api/v1/documents/entity/:entityType/:entityId` | List ACTIVE docs for an entity             |
| DELETE | `/api/v1/documents/:documentId`                  | Soft-delete                                |
| PATCH  | `/api/v1/documents/:documentId/archive`          | Archive                                    |

**Upload flow**

1. Handler validates body with Zod (`entityType` ∈ allow-list, `mimeType`
   matches allow-list prefix, `sizeBytes` ≤ `MAX_UPLOAD_BYTES`,
   `filename` non-empty).
2. `createPendingDocument` inserts row with `status: PENDING_UPLOAD`,
   `uploadedBy: c.get('userId')`, tenant-scoped via `db`.
3. `buildS3Key` using row id.
4. `presignUpload` with locked `ContentType` / `ContentLength`.
5. Response: `{ data: { documentId, uploadUrl, expiresInSeconds: 900 } }`.

**Finalize flow**

- Client uploads, then calls `POST /documents/:id/finalize`.
- Handler calls `finalizeDocument`. (A background step could HEAD the
  object to verify presence — leave as a follow-up, not blocking here.)
- Future: replace with S3 `ObjectCreated:*` event → EventBridge → Lambda
  that flips the row, removing the client round-trip.

**Download flow**

- Fetch via `findDocumentById` (internal variant).
- If null or `status !== ACTIVE`: return `404 { error: 'Document not found', code: 'NOT_FOUND' }`.
  **Do not distinguish "not found" from "not ready" / "tenant mismatch"**
  — the tenant-scoped `db` guarantees row-level isolation and leaking
  existence aids enumeration.
- Return `{ data: { downloadUrl, expiresInSeconds: 300 } }`.

**List flow**

- Validate `entityType` against allow-list.
- `listDocumentsForEntity` → `{ data, meta: { count: data.length } }`.

**Delete / archive** — straightforward; 404 if row missing.

---

## 6. CDK — New `DocumentsStack` (`packages/infra/lib/stacks/documents-stack.ts`)

```ts
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { type Construct } from 'constructs'

export class DocumentsStack extends cdk.Stack {
  public readonly bucket: s3.IBucket

  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props)

    const bucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `pegasus-documents-${cdk.Stack.of(this).account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'], // tightened to app domains once known
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'transition-to-intelligent-tiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      // NB: intentionally no expiration rule — deletion is app-controlled.
    })

    this.bucket = bucket

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: bucket.bucketName,
      exportName: 'PegasusDocumentsBucketName',
    })
    new cdk.CfnOutput(this, 'DocumentsBucketArn', {
      value: bucket.bucketArn,
      exportName: 'PegasusDocumentsBucketArn',
    })
  }
}
```

### Wiring into `ApiStack`

1. Add `documentsBucket?: s3.IBucket` to `ApiStackProps`.
2. In the `ApiStack` constructor, after the Lambda is created:
   ```ts
   if (props.documentsBucket) {
     props.documentsBucket.grantReadWrite(apiFunction)
     props.documentsBucket.grantDelete(apiFunction)
     apiFunction.addEnvironment('DOCUMENTS_BUCKET_NAME', props.documentsBucket.bucketName)
   }
   ```
   `grantReadWrite` covers `GetObject` + `PutObject`; plus explicit
   `grantDelete` so the future hard-delete worker can share the same role.
   Scope is the bucket only — matches the original prompt's constraint.
3. In `packages/infra/bin/app.ts`:
   ```ts
   const documents = new DocumentsStack(app, 'PegasusDocumentsStack', { env })
   const api = new ApiStack(app, 'PegasusApiStack', { env, documentsBucket: documents.bucket, ... })
   ```
4. Add a CDK snapshot test update (existing `__tests__` directory) —
   `resourceCountIs` for the new bucket and the IAM policy change.

### Local `.env.example`

Add:

```
# S3 bucket for document uploads. Local dev can point at a LocalStack instance
# or any dev bucket the Lambda role can reach.
DOCUMENTS_BUCKET_NAME=pegasus-documents-local
```

---

## 7. Tests

Follow existing patterns in `apps/api`:

- `apps/api/src/repositories/__tests__/document.repository.test.ts` —
  gated with `describe.skipIf(!process.env['DATABASE_URL'])`.
  Covers create → finalize → list → delete → archive.
- `apps/api/src/handlers/documents.test.ts` — handler-level, mocks
  `presignUpload` / `presignDownload` with `vi.mock('../lib/documents-s3')`
  and mocks the repository. Asserts:
  - 400 on invalid mime type / oversize / bad entity type
  - 401 when tenant middleware rejects (existing middleware test pattern)
  - 404 when document absent or wrong tenant (same response body)
  - 200 happy path returns `uploadUrl` / `downloadUrl` but **never**
    `s3Key` / `s3Bucket` (snapshot the response keys)
- `packages/domain` — add a small test confirming the `Document` domain
  type is exported and narrowable against `DocumentStatus` literals.

**CDK**: add assertions that the `DocumentsBucket` exists, blocks public
access, has versioning enabled, and that `ApiFunction`'s role has a policy
scoped to the bucket ARN.

---

## 8. Rollout / Ops

- Deploy order: `DocumentsStack` → `ApiStack` (redeploy with env var) →
  schema migration. The Lambda will start returning `DOCUMENTS_BUCKET_NAME
is not set` if it's invoked before the redeploy — acceptable since the
  routes are new.
- Follow-up plans (out of scope here):
  1. **Hard-delete worker** — EventBridge schedule, Lambda that purges
     `PENDING_DELETION` rows + their S3 objects after N days.
  2. **Virus scan** — S3 `ObjectCreated` → scan Lambda → promotes
     `PENDING_UPLOAD → ACTIVE` or marks `QUARANTINED`.
  3. **Tenant-web upload UX** — React dropzone that calls the three-step
     flow (upload-url → PUT to S3 → finalize).

---

## Definition of Done

- [ ] `20260414120000_add_documents` migration applies cleanly (forward
      and reverse checked locally).
- [ ] `packages/domain` exports `Document`, `DocumentStatus`, `DocumentId`;
      no S3 fields on the domain type.
- [ ] Repository functions implemented and unit-tested. All reads/writes
      flow through the tenant-scoped `db` from `c.get('db')`.
- [ ] Handler uses **no try/catch**; errors bubble to `app.onError`.
      Zod validates body/params; 400/404 shapes match project convention.
- [ ] Response bodies contain **no** `s3Key` or `s3Bucket` (asserted in
      handler tests).
- [ ] `DocumentsStack` created; bucket versioned, SSE-S3, public access
      blocked, TLS enforced, CORS for PUT/GET, lifecycle transition to
      INTELLIGENT_TIERING at 90 days, **no expiration rule**.
- [ ] `ApiStack` grants read/write/delete scoped to the bucket, injects
      `DOCUMENTS_BUCKET_NAME` env var.
- [ ] CDK snapshot tests updated; `cdk diff` on other stacks shows no
      unintended changes.
- [ ] `DOCUMENTS_BUCKET_NAME` present in `.env.example`; `documents-s3.ts`
      throws a clear startup error if missing.
- [ ] `dolas/agents/project/PATTERNS.md` updated with the
      `PENDING_UPLOAD → finalize → ACTIVE` pattern so future uploads
      (photos, signatures, etc.) reuse it.
