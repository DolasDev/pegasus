import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Truck, FileText, Users, Receipt } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { movesQueryOptions } from '@/api/queries/moves'
import { customersQueryOptions } from '@/api/queries/customers'
import { invoicesQueryOptions } from '@/api/queries/billing'

export function DashboardPage() {
  const { data: moves } = useQuery(movesQueryOptions)
  const { data: customers } = useQuery(customersQueryOptions)
  const { data: invoices } = useQuery(invoicesQueryOptions)

  const pendingMoves = moves?.filter((m) => m.status === 'PENDING').length ?? 0
  const openInvoices =
    invoices?.filter((i) => i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID').length ?? 0

  const stats = [
    {
      label: 'Total Moves',
      value: moves?.length ?? '—',
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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to Pegasus Move Management.
        </p>
      </div>

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
    </div>
  )
}
