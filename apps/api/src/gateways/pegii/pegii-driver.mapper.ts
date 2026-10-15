// pegII driver-financials → DriverFinancials (anti-corruption). Tolerant of
// absent fields: money that is not a finite number becomes null, a pending
// settlement block that is missing means "nothing pending".

import type { DriverFinancials } from '../driver.gateway'
import type { PegiiDriverFinancialsDto } from './pegii-driver.dto'

function money(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function mapPegiiDriverFinancials(dto: PegiiDriverFinancialsDto): DriverFinancials {
  const me = dto.monthEnd
  const monthEnd =
    me && typeof me.year === 'number' && typeof me.month === 'number' && money(me.balance) !== null
      ? { year: me.year, month: me.month, balance: me.balance as number }
      : null
  return {
    runningBalance: money(dto.runningBalance),
    escrowHeld: money(dto.escrowHeld),
    monthEnd,
    pendingSettlement: {
      total: money(dto.pendingSettlement?.total) ?? 0,
      count: typeof dto.pendingSettlement?.count === 'number' ? dto.pendingSettlement.count : 0,
    },
  }
}
