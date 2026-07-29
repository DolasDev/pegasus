// ---------------------------------------------------------------------------
// AppShell tests — focus on Settings nav visibility by role.
//
// Server-side Cedar already 403s the underlying calls; here we pin the
// sidebar behavior so non-admins don't see dead-end Settings entries and
// the "Settings" section header doesn't render orphaned.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock router primitives — AppShell only uses `Link` (rendered as <a>) and
// `useRouterState({ select })` (for reactive active-link styling). `currentPathname`
// is mutable so a test can point the "current route" at a submenu child.
let currentPathname = '/dashboard'
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: currentPathname } }),
}))

// Mock session — minimal Session shape; AppShell reads `tenantName` and
// `email` for the header but the values don't drive any test assertions.
vi.mock('@/auth/session', () => ({
  getSession: () => ({
    sub: 'u-1',
    tenantId: 't-1',
    tenantName: 'Acme',
    roleNames: ['tenant_admin'],
    role: 'tenant_admin',
    email: 'user@example.com',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ssoProvider: null,
    token: 'tok',
  }),
  clearSession: vi.fn(),
}))

// Cognito helpers are only invoked on logout — stub them so the import resolves.
vi.mock('@/auth/cognito', () => ({
  getCognitoConfig: () => {
    throw new Error('not used in tests')
  },
  buildLogoutUrl: vi.fn(),
}))

// Permissions hook — overridden per-test via `mockPermissions`.
// `capabilities` is optional; the real `hasCapability` fails open, so an absent
// flag → true and only an explicit `false` gates a feature off.
let mockPermissions: {
  isLoading: boolean
  roles: string[]
  capabilities?: Record<string, boolean>
} = {
  isLoading: false,
  roles: ['tenant_admin'],
}
vi.mock('@/auth/permissions', () => ({
  usePermissions: () => ({
    isLoading: mockPermissions.isLoading,
    has: () => true,
    allOf: () => true,
    anyOf: () => true,
    permissions: new Set<string>(),
    roles: mockPermissions.roles,
    hasCapability: (c: string) => mockPermissions.capabilities?.[c] !== false,
  }),
}))

import { AppShell } from '@/components/AppShell'

const SETTINGS_LABELS = ['Users', 'SSO Providers', 'Developer', 'Workflows']

describe('AppShell — Settings nav visibility', () => {
  beforeEach(() => {
    mockPermissions = { isLoading: false, roles: ['tenant_admin'] }
    currentPathname = '/dashboard'
  })

  it('shows the Settings header and all four items for tenant_admin', () => {
    mockPermissions = { isLoading: false, roles: ['tenant_admin'] }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(screen.getByText('Settings')).toBeInTheDocument()
    for (const label of SETTINGS_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('hides the Settings header and all four items for a non-admin role', () => {
    mockPermissions = { isLoading: false, roles: ['long_distance_dispatch'] }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    for (const label of SETTINGS_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('hides the Settings section when the user has no roles', () => {
    mockPermissions = { isLoading: false, roles: [] }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    for (const label of SETTINGS_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('hides the Settings section while permissions are still loading', () => {
    // Avoids a flash of Settings links between mount and the permissions
    // query resolving for a real non-admin.
    mockPermissions = { isLoading: true, roles: [] }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    for (const label of SETTINGS_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })
})

describe('AppShell — Operations nav capability gate', () => {
  beforeEach(() => {
    mockPermissions = { isLoading: false, roles: ['tenant_admin'] }
    currentPathname = '/dashboard'
  })

  it('shows Operations when the tenant has the longhaul capability', () => {
    mockPermissions = {
      isLoading: false,
      roles: ['tenant_admin'],
      capabilities: { longhaul: true },
    }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    expect(screen.getByText('Operations')).toBeInTheDocument()
  })

  it('hides Operations when the tenant explicitly lacks longhaul, even for an admin', () => {
    mockPermissions = {
      isLoading: false,
      roles: ['tenant_admin'],
      capabilities: { longhaul: false },
    }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    expect(screen.queryByText('Operations')).not.toBeInTheDocument()
    // A role-only item is unaffected by the capability gate.
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows Operations when the capability flag is absent (fail-open on rollout skew)', () => {
    // No `capabilities` — an older API that has not shipped the field yet must
    // not transiently hide a real tenant's Operations.
    mockPermissions = { isLoading: false, roles: ['tenant_admin'] }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    expect(screen.getByText('Operations')).toBeInTheDocument()
  })
})

describe('AppShell — Operations submenu per-child role gate', () => {
  // Children only render while the group is expanded, which happens when the
  // current route is inside the section. Point it at Availability (reachable by
  // every operations role) so the Planning/Trips children are in the DOM to
  // assert on — mirrors how the highlight tests below open the group.
  beforeEach(() => {
    currentPathname = '/driver-planning'
  })

  it('shows Planning and Trips to operations_admin', () => {
    mockPermissions = {
      isLoading: false,
      roles: ['operations_admin'],
      capabilities: { longhaul: true },
    }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Trips')).toBeInTheDocument()
  })

  it('shows Planning and Trips to tenant_admin', () => {
    mockPermissions = {
      isLoading: false,
      roles: ['tenant_admin'],
      capabilities: { longhaul: true },
    }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Trips')).toBeInTheDocument()
  })

  it('hides Planning/Trips from long_distance_dispatch but keeps Availability and Shipments', () => {
    mockPermissions = {
      isLoading: false,
      roles: ['long_distance_dispatch'],
      capabilities: { longhaul: true },
    }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    // The Operations section and its unrestricted children stay visible…
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Availability')).toBeInTheDocument()
    expect(screen.getByText('Shipments')).toBeInTheDocument()
    // …but the manager-only children are filtered out.
    expect(screen.queryByText('Planning')).not.toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
  })

  it('hides Planning/Trips from central_planning_dispatch as well', () => {
    mockPermissions = {
      isLoading: false,
      roles: ['central_planning_dispatch'],
      capabilities: { longhaul: true },
    }
    render(
      <AppShell>
        <div />
      </AppShell>,
    )
    expect(screen.getByText('Operations')).toBeInTheDocument()
    expect(screen.queryByText('Planning')).not.toBeInTheDocument()
    expect(screen.queryByText('Trips')).not.toBeInTheDocument()
  })
})

describe('AppShell — submenu active highlight follows the current route', () => {
  beforeEach(() => {
    mockPermissions = {
      isLoading: false,
      roles: ['tenant_admin'],
      capabilities: { longhaul: true },
    }
  })

  // Query by href so the assertion is unambiguous — labels like "Moves"/"Quotes"
  // appear both as top-level nav and as App Settings children. Compare on the
  // exact `bg-accent` class token: the inactive style contains `hover:bg-accent/50`,
  // so a substring check would false-positive — token membership does not.
  const isLinkActive = (container: HTMLElement, href: string): boolean => {
    const cls = container.querySelector(`a[href="${href}"]`)?.getAttribute('class') ?? ''
    return cls.split(/\s+/).includes('bg-accent')
  }

  it('highlights the App Settings child matching the pathname, not its siblings', () => {
    currentPathname = '/settings/app/quotes'
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(isLinkActive(container, '/settings/app/quotes')).toBe(true)
    expect(isLinkActive(container, '/settings/app/moves')).toBe(false)
  })

  it('moves the App Settings highlight when the pathname points at a different child', () => {
    currentPathname = '/settings/app/moves'
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(isLinkActive(container, '/settings/app/moves')).toBe(true)
    expect(isLinkActive(container, '/settings/app/quotes')).toBe(false)
  })

  it('lists both Developer children, and highlights only the active one', () => {
    // The Developer submenu IS the "tabs" mechanism under Settings → Developer;
    // a missing entry silently strands a whole page.
    currentPathname = '/settings/developer/integrations'
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(container.querySelector('a[href="/settings/developer/configs"]')).not.toBeNull()
    expect(isLinkActive(container, '/settings/developer/integrations')).toBe(true)
    expect(isLinkActive(container, '/settings/developer/configs')).toBe(false)
  })

  it('highlights the matching Operations child and not its siblings', () => {
    currentPathname = '/driver-planning/trips'
    const { container } = render(
      <AppShell>
        <div />
      </AppShell>,
    )

    expect(isLinkActive(container, '/driver-planning/trips')).toBe(true)
    // A sibling sub-route stays inactive. (The `/driver-planning` href is shared
    // by the group parent and the exact `Availability` child, so it's asserted
    // via the browser check, not here.)
    expect(isLinkActive(container, '/driver-planning/planning')).toBe(false)
  })
})
