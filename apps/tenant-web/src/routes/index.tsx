import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Truck, FileText, Users, Receipt, PackagePlus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { movesQueryOptions } from '@/api/queries/moves'
import { customersQueryOptions } from '@/api/queries/customers'
import { invoicesQueryOptions } from '@/api/queries/billing'
import {
  dashboardPegiiQueryOptions,
  type DashboardPegiiData,
  type PegiiMoveBreakdownRow,
} from '@/api/queries/dashboard'

// Per-user, per-device toggle. Persisted in localStorage with the same
// try/catch-guarded pattern as the sidebar-collapsed flag in AppShell.tsx —
// localStorage may be unavailable (private mode, restricted sandboxes).
const PEGII_TOGGLE_KEY = 'dashboard:use-pegii'

function readPegiiToggle(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PEGII_TOGGLE_KEY) === '1'
  } catch {
    return false
  }
}

function writePegiiToggle(next: boolean): void {
  try {
    window.localStorage.setItem(PEGII_TOGGLE_KEY, next ? '1' : '0')
  } catch {
    // localStorage may be unavailable (private mode) — ignore.
  }
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function sumMoveCount(rows: PegiiMoveBreakdownRow[] | undefined): number {
  return rows?.reduce((acc, r) => acc + (r.move_count ?? 0), 0) ?? 0
}

export function DashboardPage() {
  const [usePegII, setUsePegII] = useState<boolean>(readPegiiToggle)

  function togglePegII() {
    setUsePegII((prev) => {
      const next = !prev
      writePegiiToggle(next)
      return next
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome to Pegasus Move Management.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            data-testid="use-pegii-toggle"
            className="h-4 w-4 rounded border-input accent-primary"
            checked={usePegII}
            onChange={togglePegII}
          />
          Use PegII Data
        </label>
      </div>

      {usePegII ? <PegiiDashboard /> : <CloudDashboard />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Default (cloud Postgres) dashboard — unchanged behavior.
// ---------------------------------------------------------------------------

function CloudDashboard() {
  const { data: movesResult } = useQuery(movesQueryOptions)
  const { data: customersResult } = useQuery(customersQueryOptions)
  const { data: invoicesResult } = useQuery(invoicesQueryOptions)

  const moves = movesResult?.data
  const customers = customersResult?.data
  const invoices = invoicesResult?.data

  const pendingMoves = moves?.filter((m) => m.status === 'PENDING').length ?? 0
  const openInvoices =
    invoices?.filter((i) => i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID').length ?? 0

  const stats = [
    {
      label: 'Total Moves',
      value: movesResult?.meta.total ?? moves?.length ?? '—',
      icon: Truck,
      href: '/moves',
    },
    {
      label: 'Pending Moves',
      value: pendingMoves,
      icon: Truck,
      href: '/moves',
    },
    {
      label: 'Customers',
      value: customers?.length ?? '—',
      icon: Users,
      href: '/customers',
    },
    {
      label: 'Open Invoices',
      value: openInvoices,
      icon: Receipt,
      href: '/invoices',
    },
  ] as const

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} to={stat.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { href: '/moves', label: 'View all moves', icon: Truck },
          { href: '/quotes', label: 'Manage quotes', icon: FileText },
          { href: '/customers', label: 'Browse customers', icon: Users },
        ].map((link) => (
          <Link key={link.href} to={link.href}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center gap-3 pt-6">
                <link.icon className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">{link.label}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// PegII (on-prem MSSQL views) dashboard — summary tiles + grouped breakdown.
// ---------------------------------------------------------------------------

function PegiiDashboard() {
  const { data, isLoading, isError, error } = useQuery(dashboardPegiiQueryOptions(true))

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading PegII data…</p>
  }
  if (isError) {
    const notConfigured =
      error instanceof Error && /MSSQL_NOT_CONFIGURED|not configured/i.test(error.message)
    return (
      <p className="text-sm text-destructive" data-testid="pegii-error">
        {notConfigured
          ? 'The legacy (PegII) database is not configured for this tenant.'
          : `Failed to load PegII data: ${error instanceof Error ? error.message : 'unknown error'}`}
      </p>
    )
  }

  const d: DashboardPegiiData = data ?? { newOrders: [], inTransit: [], totalInvoicesYtd: 0 }

  const tiles = [
    { label: 'New Orders YTD', value: sumMoveCount(d.newOrders), icon: PackagePlus },
    { label: 'In Transit', value: sumMoveCount(d.inTransit), icon: Truck },
    { label: 'Total Invoices YTD', value: usdFormatter.format(d.totalInvoicesYtd), icon: Receipt },
  ] as const

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{tile.label}</CardTitle>
              <tile.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tile.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <BreakdownTable title="New Orders YTD" rows={d.newOrders} />
        <BreakdownTable title="In Transit" rows={d.inTransit} />
      </div>
    </>
  )
}

function BreakdownTable({ title, rows }: { title: string; rows: PegiiMoveBreakdownRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No records.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Move Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={`${row.movetype}-${row.move_desc}-${i}`}>
                  <TableCell>{row.movetype}</TableCell>
                  <TableCell>{row.move_desc}</TableCell>
                  <TableCell className="text-right">{row.move_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
