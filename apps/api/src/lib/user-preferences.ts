// ---------------------------------------------------------------------------
// Per-user preferences — schema + repo.
//
// Backed by TenantUser.preferences (Json column). Deliberately the same shape as
// lib/app-settings.ts, one level down: zod parses with defaults on every read,
// so a user row that pre-dates a new field still hydrates to a fully-typed
// object and adding a preference is a code change, NOT a migration.
//
// Repo seam: getUserPreferences / updateUserPreferences are the only call sites
// that touch storage.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'

/**
 * `defaultDashboardSlug` is a SLUG, never a DashboardDefinition id.
 *
 * An id pins one immutable version, so a user's default would silently freeze
 * at whatever version was current when they set it — they would stop seeing
 * their team's edits and have no idea why. A slug resolves to "latest PUBLISHED
 * for this slug that I can see", which also lets a tenant's fork transparently
 * shadow the GLOBAL original.
 *
 * Null / absent means "no explicit default" — the caller falls back to the
 * built-in dashboard. A slug that no longer resolves (archived, or a fork that
 * was withdrawn) ALSO falls back silently: a dangling preference is not a user
 * error and must never surface as one.
 */
const ReportingPreferences = z
  .object({
    defaultDashboardSlug: z.string().min(1).max(128).nullable().optional(),
  })
  .partial()
  .default({})

const UserPreferencesSchema = z
  .object({
    reporting: ReportingPreferences,
  })
  .partial()
  .default({})

export type UserPreferences = z.infer<typeof UserPreferencesSchema>

/** Patch shape accepted by PATCH /me/preferences — same tree, all optional. */
export const UserPreferencesPatch = z.object({
  reporting: z
    .object({
      defaultDashboardSlug: z.string().min(1).max(128).nullable(),
    })
    .partial()
    .optional(),
})
export type UserPreferencesPatchInput = z.infer<typeof UserPreferencesPatch>

/** Always returns a fully-hydrated object, even for a user with a null column. */
export async function getUserPreferences(
  db: PrismaClient,
  userId: string,
): Promise<UserPreferences> {
  const row = await db.tenantUser.findUnique({
    where: { id: userId },
    select: { preferences: true },
  })
  return UserPreferencesSchema.parse(row?.preferences ?? {})
}

/**
 * Shallow-merge a patch into the stored tree, one section at a time.
 *
 * Merging per-section (rather than replacing the whole blob) means a client that
 * knows nothing about a section added later cannot wipe it by round-tripping an
 * older shape.
 */
export async function updateUserPreferences(
  db: PrismaClient,
  userId: string,
  patch: UserPreferencesPatchInput,
): Promise<UserPreferences> {
  const current = await getUserPreferences(db, userId)

  const next: UserPreferences = {
    ...current,
    ...(patch.reporting ? { reporting: { ...current.reporting, ...patch.reporting } } : {}),
  }

  const parsed = UserPreferencesSchema.parse(next)
  await db.tenantUser.update({
    where: { id: userId },
    data: { preferences: parsed },
  })
  return parsed
}
