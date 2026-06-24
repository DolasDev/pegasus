// ---------------------------------------------------------------------------
// AppShell tests — focus on Settings nav visibility by role.
//
// Server-side Cedar already 403s the underlying calls; here we pin the
// sidebar behaviour so non-admins don't see dead-end Settings entries and
// the "Settings" section header doesn't render orphaned.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

// Mock router primitives — AppShell only uses `Link` (rendered as <a>) and
// `useRouter().state.location.pathname` (for active-link styling).
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
  useRouter: () => ({ state: { location: { pathname: '/dashboard' } } }),
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
let mockPermissions: { isLoading: boolean; roles: string[] } = {
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
  }),
}))

import { AppShell } from '@/components/AppShell'

const SETTINGS_LABELS = ['Users', 'SSO Providers', 'Developer', 'Workflows']

describe('AppShell — Settings nav visibility', () => {
  beforeEach(() => {
    mockPermissions = { isLoading: false, roles: ['tenant_admin'] }
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
