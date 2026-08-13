import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithStore } from '../../../../__test-utils__/render-with-store'

vi.mock('@/features/driver-planning/utils/router-compat', () => ({
  Link: (props: any) => <a>{props.children}</a>,
  useLocation: () => ({ pathname: '/', search: '', hash: '' }),
  useNavigate: () => () => {},
  useParams: () => ({}),
  translatePath: (p: string) => p,
}))

import { ShipmentCard } from './index'
import type { LonghaulShipmentRow } from '@pegasus/longhaul-contracts'

// Typed, so a fixture cannot drift onto a field the view does not project.
const shipment = (over: Partial<LonghaulShipmentRow> = {}): LonghaulShipmentRow => ({
  order_num: 'O1',
  shipper_name: 'SMITH, JOHN',
  shipper_city: 'AUSTIN',
  shipper_state: 'TX',
  consignee_city: 'DENVER',
  consignee_state: 'CO',
  total_est_wt: 5000,
  vip: 'N',
  idc_break: 'N',
  type_packing: 'N',
  pegasus_shadow: null,
  ...over,
})

/**
 * Colour of the SIT warehouse badge — green "Scheduled" vs orange "Not
 * Scheduled". Walks up from the icon rather than assuming a parent depth,
 * because HoverToolTip inserts its own wrapper between the two.
 */
const sitIndicatorColor = (container: HTMLElement): string | undefined =>
  [...container.querySelectorAll('span')].find(
    (el) => el.querySelector('i.fa-warehouse') && el.style.color,
  )?.style.color

const render = (over: Partial<LonghaulShipmentRow> = {}) =>
  renderWithStore(<ShipmentCard shipment={shipment(over)} tripsForShipment={[]} />, {
    shipments: { selectedShipment: null } as any,
  })

describe('ShipmentCard indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Regression: the indicator tested `shipment.supervip`, a legacy TypeORM
  // entity property aliased onto `idc_break`. Raw view rows carry idc_break,
  // so S-VIP / S-WGS could never render.
  it('renders S-VIP from idc_break', () => {
    render({ idc_break: 'Y' })
    expect(screen.getByText('S-VIP')).toBeInTheDocument()
  })

  it('renders S-WGS when a super-VIP is also white-glove', () => {
    render({ idc_break: 'Y', type_packing: 'Y' })
    expect(screen.getByText('S-WGS')).toBeInTheDocument()
  })

  it('still ranks super-VIP above plain VIP', () => {
    render({ idc_break: 'Y', vip: 'Y' })
    expect(screen.getByText('S-VIP')).toBeInTheDocument()
    expect(screen.queryByText('VIP')).not.toBeInTheDocument()
  })

  it('leaves the plain VIP and no-indicator cases untouched', () => {
    const { unmount } = render({ vip: 'Y' })
    expect(screen.getByText('VIP')).toBeInTheDocument()
    unmount()

    render()
    expect(screen.queryByText('VIP')).not.toBeInTheDocument()
    expect(screen.queryByText('S-VIP')).not.toBeInTheDocument()
  })

  // The move-type badge renders beside the order number, and only for codes
  // worth calling out — 'H' (Interstate) is the common case and is deliberately
  // left blank. INTERNATIONAL was omitted because a 'Z' shipment could never
  // reach the planning list at all: the Is_Trip_Planning whitelist excluded it.
  // Now that it can (and appears in the DEFAULT, unfiltered list), a blank badge
  // would make it indistinguishable from an Interstate move.
  it('badges an INTERNATIONAL move beside the order number', () => {
    render({ order_num: 'O1', import_export: 'Z' })
    expect(screen.getByText('O1 Z')).toBeInTheDocument()
  })

  it('leaves the Interstate common case unbadged', () => {
    render({ order_num: 'O1', import_export: 'H' })
    expect(screen.getByText('O1')).toBeInTheDocument()
    expect(screen.queryByText('O1 H')).not.toBeInTheDocument()
  })

  // `import_export` is nvarchar in the legacy DB and prod holds the same
  // logical code BOTH padded and unpadded — 'M' on 470 rows and 'M ' on 1,404.
  // MSSQL comparisons ignore trailing spaces so the filter never saw it, but
  // the untrimmed JS check dropped the badge on the padded majority: MILITARY
  // and INTERNATIONAL cards rendered blank, i.e. looked like Interstate, and
  // inconsistently so row-to-row within one code.
  it.each([
    ['M', 'M'],
    ['M ', 'M'],
    ['Z ', 'Z'],
    [' OA ', 'OA'],
  ])('badges %o as %o regardless of padding', (raw, badge) => {
    render({ order_num: 'O1', import_export: raw })
    expect(screen.getByText(`O1 ${badge}`)).toBeInTheDocument()
  })

  it('leaves a padded Interstate code unbadged too', () => {
    render({ order_num: 'O1', import_export: 'H ' })
    expect(screen.getByText('O1')).toBeInTheDocument()
  })

  // Codes outside the old allow-list are reachable now that an explicit
  // move-type filter overrides the trip-planning whitelist. A blank badge would
  // make each of them read as an Interstate move.
  it.each(['OA', 'DA', 'LC', 'I', 'L', 'P', 'SP', 'C', 'TC', 'OF'])(
    'badges newly reachable move type %s',
    (code) => {
      render({ order_num: 'O1', import_export: code })
      expect(screen.getByText(`O1 ${code}`)).toBeInTheDocument()
    },
  )

  it('renders no badge when the move type is absent', () => {
    render({ order_num: 'O1', import_export: null })
    expect(screen.getByText('O1')).toBeInTheDocument()
  })

  // BEHAVIOR CHANGE (approved): the SIT delivery indicator read
  // `storage_driver_id`, which is not a column on the view — the storage driver
  // is `driver2_id`. The condition was always falsy, so a SIT shipment ALWAYS
  // took the orange "Not Scheduled" branch, in this app and in the original
  // system. These pin the corrected behavior.
  it('shows the SIT indicator as Scheduled when driver2_id is set', () => {
    const { container } = render({ sit_date: '2026-03-01', driver2_id: 4242 })
    expect(sitIndicatorColor(container)).toBe('green')
  })

  it('shows the SIT indicator as Not Scheduled when no storage driver is assigned', () => {
    const { container } = render({ sit_date: '2026-03-01', driver2_id: null })
    expect(sitIndicatorColor(container)).toBe('orange')
  })

  it('shows no SIT indicator without a sit_date', () => {
    const { container } = render({ driver2_id: 4242 })
    expect(container.querySelector('i.fa-warehouse')).toBeNull()
  })
})
