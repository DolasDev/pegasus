// ---------------------------------------------------------------------------
// react-router → TanStack Router compatibility shim.
//
// The ported longhaul code calls react-router APIs (Link, useLocation,
// useNavigate, useParams, useBlocker) with paths like "/", "/planning",
// "/trips", "/trip/$id". Inside tenant-web every Driver Planning route
// is nested under /driver-planning/*, so this shim:
//
//   - Translates legacy paths to their /driver-planning/* equivalents
//   - Bridges the two routers' hook shapes
// ---------------------------------------------------------------------------

import { type ReactNode, type CSSProperties } from 'react'
import {
  Link as TanstackLink,
  useLocation as useTanstackLocation,
  useNavigate as useTanstackNavigate,
  useParams as useTanstackParams,
  useBlocker as useTanstackBlocker,
} from '@tanstack/react-router'

const PREFIX = '/driver-planning'

/** Rewrite a legacy longhaul path to its /driver-planning/* equivalent. */
export function translatePath(path: string): string {
  if (!path) return PREFIX

  const [pathOnly, search = ''] = path.split('?')
  const qs = search ? `?${search}` : ''

  if (pathOnly === '/') return `${PREFIX}${qs}`

  // /trip/:id (singular legacy) → /driver-planning/trips/:id (plural)
  const tripDetailMatch = pathOnly.match(/^\/trip\/(.+)$/)
  if (tripDetailMatch) return `${PREFIX}/trips/${tripDetailMatch[1]}${qs}`

  if (
    pathOnly.startsWith('/planning') ||
    pathOnly.startsWith('/trips') ||
    pathOnly.startsWith('/shipments')
  ) {
    return `${PREFIX}${pathOnly}${qs}`
  }

  // Already a /driver-planning/* path or absolute external link — pass through
  return path
}

interface CompatLinkProps {
  to: string
  className?: string
  style?: CSSProperties
  onClick?: (e: React.MouseEvent) => void
  children?: ReactNode
}

export function Link({ to, ...rest }: CompatLinkProps) {
  // TanStack's Link is strongly typed against the route tree. We pass an
  // arbitrary string here intentionally — the path was either authored against
  // the longhaul HashRouter or already rewritten by translatePath. Cast to any
  // to satisfy the strict route-literal type.
  return <TanstackLink to={translatePath(to) as any} {...rest} />
}

export function useLocation(): { pathname: string; search: string; hash: string } {
  const loc = useTanstackLocation()
  const searchObj = (loc.search ?? {}) as Record<string, unknown>
  const searchString = (() => {
    const entries = Object.entries(searchObj).filter(([, v]) => v !== undefined && v !== null)
    if (entries.length === 0) return ''
    const params = new URLSearchParams()
    for (const [k, v] of entries) params.set(k, String(v))
    return `?${params.toString()}`
  })()
  return {
    pathname: loc.pathname,
    search: searchString,
    hash: loc.hash ?? '',
  }
}

export function useParams<T extends Record<string, string | undefined>>(): T {
  // strict: false avoids "no matching route" errors when the shim is used
  // outside a route that declares the requested param. Cast to any because
  // TanStack's option types intersect strictness with route literals.
  return useTanstackParams({ strict: false } as any) as T
}

export function useNavigate(): (path: string) => void {
  const navigate = useTanstackNavigate()
  return (path: string) => {
    navigate({ to: translatePath(path) as any })
  }
}

export interface BlockerState {
  state: 'unblocked' | 'blocked' | 'proceeding'
  proceed: () => void
  reset: () => void
}

/**
 * react-router-shaped `useBlocker` backed by TanStack Router's blocker.
 * Catches in-router navigations (including the tenant-web sidebar) and the
 * browser `beforeunload` event when `shouldBlock` is true.
 */
export function useBlocker(shouldBlock: boolean): BlockerState {
  const blocker = useTanstackBlocker({
    shouldBlockFn: () => shouldBlock,
    withResolver: true,
  })

  if (blocker.status === 'blocked') {
    return {
      state: 'blocked',
      proceed: blocker.proceed,
      reset: blocker.reset,
    }
  }

  return {
    state: 'unblocked',
    proceed: () => {},
    reset: () => {},
  }
}
