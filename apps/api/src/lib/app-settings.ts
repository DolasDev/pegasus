// ---------------------------------------------------------------------------
// Tenant-wide App Settings — schema + repo
//
// Backed by Tenant.appSettings (Json column). One nested object per main-menu
// section so the storage shape mirrors the /settings/app sub-nav. zod parses
// with defaults on every read, so:
//   - tenants that pre-date a new field still hydrate to a fully-typed object;
//   - adding a new optional preference is a code change, NOT a migration.
//
// Repo seam: getAppSettings / updateAppSettings are the only call sites that
// touch the storage. To migrate to AWS AppConfig, LaunchDarkly, or a
// dedicated TenantSetting table later, swap the body of these two functions;
// handlers and the UI continue to call the same interface.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'

// Mirrors the LonghaulClient union in lib/longhaul-client-config.ts. Inlined
// rather than imported because that module exports only a TS type, not a
// runtime array, and the two-element list is too stable to warrant a shared
// constants file. Keep in sync if a third client is ever onboarded.
const LONGHAUL_CLIENTS = ['nwi', 'qmm'] as const

// ---------------------------------------------------------------------------
// Section schemas — each is `.object({...}).partial().default({})` so:
//   - every field is optional (no required key in storage),
//   - omitted sections hydrate to `{}` automatically,
//   - the whole tree always parses, even from the brand-new default `{}` blob.
//
// First real field: operations.longhaulClient (nwi | qmm | null). All other
// sections are scaffold-only for now — each ships with a one-line comment
// suggesting the first preference that could land there. Add fields by
// extending the relevant z.object and the FE will pick them up via the
// AppSettings type export.
// ---------------------------------------------------------------------------

const DashboardSchema = z
  .object({
    // e.g. defaultRefreshIntervalSeconds: z.number().int().positive().optional(),
  })
  .partial()
  .default({})

const MovesSchema = z
  .object({
    // e.g. defaultPageSize: z.number().int().positive().optional(),
  })
  .partial()
  .default({})

const QuotesSchema = z
  .object({
    // e.g. currencyDisplay: z.enum(['symbol', 'code']).optional(),
  })
  .partial()
  .default({})

const CustomersSchema = z
  .object({
    // e.g. defaultFilterKey: z.enum(['lastName', 'email', 'phone']).optional(),
  })
  .partial()
  .default({})

const DispatchSchema = z
  .object({
    // e.g. boardGrouping: z.enum(['status', 'crew', 'region']).optional(),
  })
  .partial()
  .default({})

const BillingSchema = z
  .object({
    // e.g. currencyDisplay: z.enum(['symbol', 'code']).optional(),
  })
  .partial()
  .default({})

const OperationsSchema = z
  .object({
    /// Tenant-wide longhaul client selector. Mirrored into the legacy
    /// `Tenant.longhaulClient` column on write (see handlers/settings.ts) so
    /// the cloud-direct longhaul handlers keep reading from the column they
    /// already read from. The mirror lets us collapse to a single source of
    /// truth later without churning every handler in this PR.
    longhaulClient: z.enum(LONGHAUL_CLIENTS).nullable().optional(),
  })
  .partial()
  .default({})

// ---------------------------------------------------------------------------
// Root schema
// ---------------------------------------------------------------------------

// No root-level `.default({})` — each section already carries its own default,
// so passing `{}` to .parse() hydrates the full tree. A root default would
// fight TypeScript (it'd want to provide all section defaults explicitly) for
// no behavioural gain.
export const AppSettingsSchema = z.object({
  dashboard: DashboardSchema,
  moves: MovesSchema,
  quotes: QuotesSchema,
  customers: CustomersSchema,
  dispatch: DispatchSchema,
  billing: BillingSchema,
  operations: OperationsSchema,
})

export type AppSettings = z.infer<typeof AppSettingsSchema>

/** Partial-update payload accepted by PATCH /settings/app. Same shape as the
 *  root, but every section is optional and inner objects are partial — a
 *  caller can send `{ operations: { longhaulClient: 'qmm' } }` and leave the
 *  other six sections alone. */
export const AppSettingsPatchSchema = z
  .object({
    dashboard: DashboardSchema.optional(),
    moves: MovesSchema.optional(),
    quotes: QuotesSchema.optional(),
    customers: CustomersSchema.optional(),
    dispatch: DispatchSchema.optional(),
    billing: BillingSchema.optional(),
    operations: OperationsSchema.optional(),
  })
  .strict()

export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>

// ---------------------------------------------------------------------------
// Repo — the swap seam
// ---------------------------------------------------------------------------

/** Reads the tenant's appSettings JSON, parses-with-defaults, and returns a
 *  fully-typed object. Throws PrismaClientKnownRequestError if the tenant
 *  doesn't exist (let the handler decide whether to translate that to 404). */
export async function getAppSettings(db: PrismaClient, tenantId: string): Promise<AppSettings> {
  const row = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { appSettings: true },
  })
  // The Json column can be anything in TS terms; zod is the guard. Unknown
  // keys are stripped silently (zod's default), which is fine for a forwards-
  // compatible schema.
  return AppSettingsSchema.parse(row.appSettings ?? {})
}

/** Deep-merges `patch` into the tenant's current appSettings, revalidates the
 *  result, and writes it back. Section-level objects are merged shallowly:
 *  patching `{ operations: { longhaulClient: 'qmm' } }` keeps any other
 *  `operations.*` keys intact. */
export async function updateAppSettings(
  db: PrismaClient,
  tenantId: string,
  patch: AppSettingsPatch,
): Promise<AppSettings> {
  const current = await getAppSettings(db, tenantId)
  const next = mergeAppSettings(current, patch)
  await db.tenant.update({
    where: { id: tenantId },
    data: { appSettings: next as unknown as object },
  })
  return next
}

/** Exported for tests + the handler that needs to compute the merged value
 *  before writing the mirror column. Pure: doesn't touch the DB. */
export function mergeAppSettings(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  const merged: AppSettings = {
    dashboard: { ...current.dashboard, ...(patch.dashboard ?? {}) },
    moves: { ...current.moves, ...(patch.moves ?? {}) },
    quotes: { ...current.quotes, ...(patch.quotes ?? {}) },
    customers: { ...current.customers, ...(patch.customers ?? {}) },
    dispatch: { ...current.dispatch, ...(patch.dispatch ?? {}) },
    billing: { ...current.billing, ...(patch.billing ?? {}) },
    operations: { ...current.operations, ...(patch.operations ?? {}) },
  }
  // Re-parse so any cleared fields (set to undefined by the spread) drop out
  // and the result is a clean, fully-typed AppSettings.
  return AppSettingsSchema.parse(merged)
}
