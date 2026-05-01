import React, { type ReactElement } from 'react'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore, type EnhancedStore } from '@reduxjs/toolkit'
import commonReducer, { type CommonState } from '../redux/common'

export type PartialCommonState = Partial<CommonState>

const defaultCommonState: CommonState = {
  loading: false,
  driversList: [],
  error: false,
  tripStatuses: [],
  stateList: [],
  zoneList: [],
  plannersList: [],
  dispatcherList: [],
}

export function makeStore(common: PartialCommonState = {}): EnhancedStore {
  return configureStore({
    reducer: { common: commonReducer },
    preloadedState: {
      common: { ...defaultCommonState, ...common },
    },
  })
}

export interface RenderWithStoreOptions extends Omit<RenderOptions, 'wrapper'> {
  common?: PartialCommonState
  store?: EnhancedStore
}

export interface RenderWithStoreResult extends RenderResult {
  store: EnhancedStore
}

export function renderWithStore(
  ui: ReactElement,
  { common, store: providedStore, ...rtlOptions }: RenderWithStoreOptions = {},
): RenderWithStoreResult {
  const store = providedStore ?? makeStore(common)
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  )
  const result = render(ui, { wrapper: Wrapper, ...rtlOptions })
  return { ...result, store }
}
