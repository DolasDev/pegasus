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

const shipment = (over: Record<string, any> = {}) => ({
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

const render = (over: Record<string, any> = {}) =>
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
})
