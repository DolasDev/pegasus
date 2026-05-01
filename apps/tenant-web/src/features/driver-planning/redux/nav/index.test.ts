import { describe, it, expect } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import navReducer, { toggleNav, type NavState } from './index'

function makeStore(preloaded?: NavState) {
  return configureStore({
    reducer: { nav: navReducer },
    preloadedState: preloaded ? { nav: preloaded } : undefined,
  })
}

describe('nav slice', () => {
  it('has the expected initial state', () => {
    const store = makeStore()
    expect(store.getState().nav).toEqual({ loading: false, visible: true })
  })

  it('toggleNav flips visible from true to false', () => {
    const store = makeStore()
    store.dispatch(toggleNav())
    expect(store.getState().nav.visible).toBe(false)
  })

  it('toggleNav flips visible from false to true', () => {
    const store = makeStore({ loading: false, visible: false })
    store.dispatch(toggleNav())
    expect(store.getState().nav.visible).toBe(true)
  })

  it('toggleNav does not affect loading flag', () => {
    const store = makeStore({ loading: true, visible: true })
    store.dispatch(toggleNav())
    expect(store.getState().nav.loading).toBe(true)
  })

  it('two toggles return visible to original value', () => {
    const store = makeStore()
    store.dispatch(toggleNav())
    store.dispatch(toggleNav())
    expect(store.getState().nav.visible).toBe(true)
  })
})
