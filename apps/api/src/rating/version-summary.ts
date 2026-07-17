// ---------------------------------------------------------------------------
// Shared tariff-version API summary shape.
//
// Used by both the tenant-facing rating handler (GET /api/v1/rating/tariffs)
// and the platform-admin handler (GET /api/admin/tariffs) so the two surfaces
// present a byte-identical version summary and never drift. The counts come
// from the repository's `_count` include (TariffVersionWithCounts).
// ---------------------------------------------------------------------------

import type { TariffVersionWithCounts } from '../repositories'

export function mapVersionSummary(v: TariffVersionWithCounts) {
  return {
    id: v.id,
    tariffCode: v.tariffCode,
    label: v.label,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    status: v.status,
    sourceChecksum: v.sourceChecksum,
    importedBy: v.importedBy,
    counts: v._count,
  }
}
