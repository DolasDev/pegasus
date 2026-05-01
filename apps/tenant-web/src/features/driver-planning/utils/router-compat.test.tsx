// Tests for the react-router → TanStack Router compatibility shim.
//
// The shim exports `translatePath` plus thin wrappers around
// `@tanstack/react-router` (Link, useLocation, useNavigate, useParams,
// useBlocker). We mock the underlying TanStack module so that we can
// assert the shim delegates to it with rewritten paths.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, renderHook } from '@testing-library/react'
import React from 'react'

// ---- Mock @tanstack/react-router --------------------------------------------
//
// The shim imports Link/useLocation/useNavigate/useParams from the package.
// We replace each with a spy/stub so we can introspect what the shim hands
// to TanStack.

const tanstackNavigateSpy = vi.fn()
const tanstackParamsSpy = vi.fn()
const tanstackLocationSpy = vi.fn()
const tanstackLinkSpy = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: (props: any) => {
    tanstackLinkSpy(props)
    // Render an anchor so consumers can find it via DOM queries.
    return <a data-testid="tanstack-link" href={typeof props.to === 'string' ? props.to : ''} className={props.className} style={props.style} onClick={props.onClick}>{props.children}</a>
  },
  useLocation: () => tanstackLocationSpy(),
  useNavigate: () => tanstackNavigateSpy,
  useParams: (opts: any) => tanstackParamsSpy(opts),
}))

// Import after the mock is registered.
import {
  Link,
  translatePath,
  useBlocker,
  useLocation,
  useNavigate,
  useParams,
} from './router-compat'

beforeEach(() => {
  tanstackNavigateSpy.mockReset()
  tanstackParamsSpy.mockReset()
  tanstackLocationSpy.mockReset()
  tanstackLinkSpy.mockReset()
})

// ---- translatePath ----------------------------------------------------------

describe('translatePath', () => {
  it('returns the prefix for empty input', () => {
    expect(translatePath('')).toBe('/driver-planning')
  })

  it("rewrites root '/' to /driver-planning", () => {
    expect(translatePath('/')).toBe('/driver-planning')
  })

  it("rewrites root '/' with query string", () => {
    expect(translatePath('/?foo=bar')).toBe('/driver-planning?foo=bar')
  })

  it("rewrites legacy '/trip/:id' to plural '/driver-planning/trips/:id'", () => {
    expect(translatePath('/trip/abc123')).toBe('/driver-planning/trips/abc123')
  })

  it('rewrites legacy /trip/:id with query string', () => {
    expect(translatePath('/trip/abc123?tab=stops')).toBe(
      '/driver-planning/trips/abc123?tab=stops'
    )
  })

  it('prefixes /planning paths', () => {
    expect(translatePath('/planning')).toBe('/driver-planning/planning')
  })

  it('prefixes nested /planning paths with query string', () => {
    expect(translatePath('/planning/board?week=2')).toBe(
      '/driver-planning/planning/board?week=2'
    )
  })

  it('prefixes /trips listing path', () => {
    expect(translatePath('/trips')).toBe('/driver-planning/trips')
  })

  it('prefixes /trips with query string', () => {
    expect(translatePath('/trips?status=open')).toBe('/driver-planning/trips?status=open')
  })

  it('prefixes /shipments paths', () => {
    expect(translatePath('/shipments')).toBe('/driver-planning/shipments')
  })

  it('prefixes nested /shipments paths', () => {
    expect(translatePath('/shipments/123')).toBe('/driver-planning/shipments/123')
  })

  it('passes through paths that already begin with /driver-planning', () => {
    expect(translatePath('/driver-planning/trips')).toBe('/driver-planning/trips')
  })

  it('passes through unknown paths unchanged', () => {
    expect(translatePath('/some/unrelated/path')).toBe('/some/unrelated/path')
  })

  it('passes through external/absolute http(s) URLs', () => {
    expect(translatePath('https://example.com/foo')).toBe('https://example.com/foo')
  })
})

// ---- Link -------------------------------------------------------------------

describe('Link', () => {
  it('delegates to TanStack Link with translated path', () => {
    render(<Link to="/trip/42">Open trip</Link>)
    expect(tanstackLinkSpy).toHaveBeenCalledTimes(1)
    expect(tanstackLinkSpy.mock.calls[0][0].to).toBe('/driver-planning/trips/42')
  })

  it('forwards children, className, and style', () => {
    const { getByTestId } = render(
      <Link to="/planning" className="nav-link" style={{ color: 'red' }}>
        Planning
      </Link>
    )
    const anchor = getByTestId('tanstack-link')
    expect(anchor).toHaveTextContent('Planning')
    expect(anchor).toHaveClass('nav-link')
    expect(anchor.getAttribute('style')).toContain('color')
  })

  it('forwards onClick', () => {
    const onClick = vi.fn()
    const { getByTestId } = render(
      <Link to="/" onClick={onClick}>
        Home
      </Link>
    )
    getByTestId('tanstack-link').click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

// ---- useLocation ------------------------------------------------------------

describe('useLocation', () => {
  it('returns pathname/hash and serialises search-object to a string', () => {
    tanstackLocationSpy.mockReturnValue({
      pathname: '/driver-planning/trips',
      search: { status: 'open', tab: 'list' },
      hash: '#top',
    })
    const { result } = renderHook(() => useLocation())
    expect(result.current.pathname).toBe('/driver-planning/trips')
    expect(result.current.hash).toBe('#top')
    // URLSearchParams ordering is insertion-order; both keys must be present.
    expect(result.current.search.startsWith('?')).toBe(true)
    const sp = new URLSearchParams(result.current.search.slice(1))
    expect(sp.get('status')).toBe('open')
    expect(sp.get('tab')).toBe('list')
  })

  it('returns empty search string when search-object is empty', () => {
    tanstackLocationSpy.mockReturnValue({
      pathname: '/driver-planning',
      search: {},
      hash: '',
    })
    const { result } = renderHook(() => useLocation())
    expect(result.current.search).toBe('')
    expect(result.current.hash).toBe('')
  })

  it('drops null/undefined search values', () => {
    tanstackLocationSpy.mockReturnValue({
      pathname: '/driver-planning',
      search: { foo: 'bar', skip: undefined, alsoSkip: null },
      hash: '',
    })
    const { result } = renderHook(() => useLocation())
    const sp = new URLSearchParams(result.current.search.slice(1))
    expect(sp.get('foo')).toBe('bar')
    expect(sp.has('skip')).toBe(false)
    expect(sp.has('alsoSkip')).toBe(false)
  })

  it('coerces non-string search values to strings', () => {
    tanstackLocationSpy.mockReturnValue({
      pathname: '/driver-planning',
      search: { page: 3, active: true },
      hash: '',
    })
    const { result } = renderHook(() => useLocation())
    const sp = new URLSearchParams(result.current.search.slice(1))
    expect(sp.get('page')).toBe('3')
    expect(sp.get('active')).toBe('true')
  })

  it('defaults missing search/hash to safe values', () => {
    tanstackLocationSpy.mockReturnValue({ pathname: '/driver-planning' })
    const { result } = renderHook(() => useLocation())
    expect(result.current.search).toBe('')
    expect(result.current.hash).toBe('')
  })
})

// ---- useParams --------------------------------------------------------------

describe('useParams', () => {
  it('passes strict:false to TanStack and returns its result', () => {
    tanstackParamsSpy.mockReturnValue({ id: 'trip-1' })
    const { result } = renderHook(() => useParams<{ id: string }>())
    expect(tanstackParamsSpy).toHaveBeenCalledTimes(1)
    expect(tanstackParamsSpy.mock.calls[0][0]).toMatchObject({ strict: false })
    expect(result.current).toEqual({ id: 'trip-1' })
  })
})

// ---- useNavigate ------------------------------------------------------------

describe('useNavigate', () => {
  it('returns a function that navigates with a translated path', () => {
    const { result } = renderHook(() => useNavigate())
    result.current('/trip/9')
    expect(tanstackNavigateSpy).toHaveBeenCalledTimes(1)
    expect(tanstackNavigateSpy.mock.calls[0][0]).toEqual({
      to: '/driver-planning/trips/9',
    })
  })

  it('translates legacy root and prefixed paths', () => {
    const { result } = renderHook(() => useNavigate())
    result.current('/')
    result.current('/planning')
    result.current('/shipments/77')
    expect(tanstackNavigateSpy.mock.calls.map((c) => c[0].to)).toEqual([
      '/driver-planning',
      '/driver-planning/planning',
      '/driver-planning/shipments/77',
    ])
  })

  it('passes through already-translated paths', () => {
    const { result } = renderHook(() => useNavigate())
    result.current('/driver-planning/trips/1')
    expect(tanstackNavigateSpy.mock.calls[0][0].to).toBe('/driver-planning/trips/1')
  })
})

// ---- useBlocker -------------------------------------------------------------

describe('useBlocker', () => {
  it('does not throw when called', () => {
    expect(() => useBlocker(true)).not.toThrow()
    expect(() => useBlocker(false)).not.toThrow()
  })

  it('returns a permanently-unblocked state', () => {
    const blocker = useBlocker(true)
    expect(blocker.state).toBe('unblocked')
    expect(typeof blocker.proceed).toBe('function')
    expect(typeof blocker.reset).toBe('function')
    // proceed/reset are no-ops; calling them must not throw.
    expect(() => blocker.proceed()).not.toThrow()
    expect(() => blocker.reset()).not.toThrow()
  })
})
