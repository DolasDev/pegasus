import type { ReactElement, ReactNode } from 'react'
import { Provider } from 'react-redux'
import { configureStore, type Reducer } from '@reduxjs/toolkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'

import pendingTripsReducer from '../redux/pending-trips'
import shipmentReducer from '../redux/shipments'
import commonReducer from '../redux/common'
import tripReducer from '../redux/trips'
import navReducer from '../redux/nav'
import userReducer from '../redux/user'
import versionReducer from '../redux/version'

const reducers = {
  tripPlanning: pendingTripsReducer,
  shipments: shipmentReducer,
  common: commonReducer,
  trips: tripReducer,
  nav: navReducer,
  user: userReducer,
  version: versionReducer,
} as const

export type TestRootState = {
  [K in keyof typeof reducers]: ReturnType<(typeof reducers)[K]>
}

export type PartialTestRootState = {
  [K in keyof TestRootState]?: Partial<TestRootState[K]>
}

export function makeTestStore(preloadedSlices: PartialTestRootState = {}) {
  // Build a preloaded state by running each reducer with its initial state then
  // shallow-merging in any caller overrides for that slice. This lets tests
  // seed e.g. `user.user` without having to know about every other field.
  const baseState = Object.fromEntries(
    Object.entries(reducers).map(([key, reducer]) => [
      key,
      (reducer as Reducer)(undefined, { type: '@@INIT' }),
    ]),
  ) as TestRootState

  const preloadedState = Object.fromEntries(
    Object.entries(baseState).map(([key, slice]) => [
      key,
      { ...(slice as object), ...((preloadedSlices as any)[key] ?? {}) },
    ]),
  ) as TestRootState

  return configureStore({
    reducer: reducers,
    preloadedState,
  })
}

export type TestStore = ReturnType<typeof makeTestStore>

export interface RenderWithStoreOptions extends Omit<RenderOptions, 'wrapper'> {
  preloadedState?: PartialTestRootState
  store?: TestStore
  queryClient?: QueryClient
}

export function makeTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithStore(
  ui: ReactElement,
  { preloadedState, store, queryClient, ...options }: RenderWithStoreOptions = {},
): RenderResult & { store: TestStore; queryClient: QueryClient } {
  const testStore = store ?? makeTestStore(preloadedState)
  const qc = queryClient ?? makeTestQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={testStore}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </Provider>
    )
  }
  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    store: testStore,
    queryClient: qc,
  }
}
