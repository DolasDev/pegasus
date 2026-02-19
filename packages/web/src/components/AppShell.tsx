import { Link, useRouter } from '@tanstack/react-router'
import {
  LayoutDashboard,
  Truck,
  FileText,
  Users,
  Calendar,
  Receipt,
  type LucideIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/' as const, label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/moves' as const, label: 'Moves', icon: Truck, exact: false },
  { to: '/quotes' as const, label: 'Quotes', icon: FileText, exact: false },
  { to: '/customers' as const, label: 'Customers', icon: Users, exact: false },
  { to: '/dispatch' as const, label: 'Dispatch', icon: Calendar, exact: false },
  { to: '/invoices' as const, label: 'Billing', icon: Receipt, exact: false },
] as const

type NavItemProps = {
  to: string
  label: string
  icon: LucideIcon
  exact: boolean
}

function NavItem({ to, label, icon: Icon, exact }: NavItemProps) {
  const router = useRouter()
  const pathname = router.state.location.pathname
  const isActive = exact ? pathname === to : pathname === to || pathname.startsWith(to + '/')

  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
      )}
    >
      <Icon size={16} />
      {label}
    </Link>
  )
}

type AppShellProps = {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r bg-card">
        <div className="flex h-14 items-center px-4">
          <span className="text-lg font-bold tracking-tight text-foreground">Pegasus</span>
        </div>
        <Separator />
        <ScrollArea className="flex-1 py-2">
          <nav className="space-y-1 px-2">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
        </ScrollArea>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center border-b px-6">
          <span className="text-sm text-muted-foreground">Move Management Platform</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
