// ---------------------------------------------------------------------------
// Customer data-source selector. Resolves the per-tenant Tenant.customerSource
// column to a strict enum. Mirrors lib/longhaul-client-config.ts's fail-fast
// philosophy: an unrecognised value throws rather than silently defaulting, so
// bad config data surfaces loudly instead of quietly falling back to Postgres.
// Null/undefined (the common case) is the legitimate default → 'prisma'.
// ---------------------------------------------------------------------------

export type CustomerSource = 'prisma' | 'pegii'

export function normalizeCustomerSource(raw: string | null | undefined): CustomerSource {
  if (raw == null) return 'prisma'
  const v = raw.trim().toLowerCase()
  if (v !== 'prisma' && v !== 'pegii') {
    throw new Error(
      `[customer-source] Unknown customerSource "${raw}". Expected "prisma" or "pegii".`,
    )
  }
  return v
}
