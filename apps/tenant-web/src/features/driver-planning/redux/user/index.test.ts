import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'

vi.mock('../../utils/api', () => ({
  API: {
    fetchUser: vi.fn(),
  },
}))

import userReducer, { fetchUser } from './index'
import { API } from '../../utils/api'

const mockedApi = API as unknown as { fetchUser: ReturnType<typeof vi.fn> }

function makeStore() {
  return configureStore({
    reducer: { user: userReducer },
  })
}

describe('user slice — reducer', () => {
  it('has the expected initial state', () => {
    const store = makeStore()
    expect(store.getState().user).toEqual({
      loading: false,
      user: null,
      errorMessage: null,
    })
  })

  it('fetchUserStart sets loading and clears user/errorMessage', () => {
    const store = configureStore({
      reducer: { user: userReducer },
      preloadedState: {
        user: { loading: false, user: { id: 1 }, errorMessage: 'old error' } as any,
      },
    })
    store.dispatch({ type: 'user/fetchUserStart' })
    expect(store.getState().user).toEqual({
      loading: true,
      user: null,
      errorMessage: null,
    })
  })

  it('fetchUserSuccess stores payload and clears loading', () => {
    const store = makeStore()
    store.dispatch({ type: 'user/fetchUserStart' })
    store.dispatch({ type: 'user/fetchUserSuccess', payload: { id: 42, name: 'Alice' } })
    expect(store.getState().user).toEqual({
      loading: false,
      user: { id: 42, name: 'Alice' },
      errorMessage: null,
    })
  })

  it('fetchUserError stores error message and clears loading + user', () => {
    const store = configureStore({
      reducer: { user: userReducer },
      preloadedState: {
        user: { loading: true, user: { id: 1 }, errorMessage: null } as any,
      },
    })
    store.dispatch({ type: 'user/fetchUserError', payload: 'bad things' })
    expect(store.getState().user).toEqual({
      loading: false,
      user: null,
      errorMessage: 'bad things',
    })
  })
})

describe('user slice — fetchUser thunk', () => {
  beforeEach(() => {
    mockedApi.fetchUser.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches start then success on resolved API call', async () => {
    const payload = { id: 1, name: 'Bob' }
    mockedApi.fetchUser.mockResolvedValue(payload)
    const store = makeStore()
    await store.dispatch(fetchUser() as any)

    expect(mockedApi.fetchUser).toHaveBeenCalledTimes(1)
    expect(store.getState().user).toEqual({
      loading: false,
      user: payload,
      errorMessage: null,
    })
  })

  it('sets loading=true synchronously before the promise resolves', async () => {
    let resolveFn: (v: any) => void = () => {}
    mockedApi.fetchUser.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )
    const store = makeStore()
    const promise = store.dispatch(fetchUser() as any)
    expect(store.getState().user.loading).toBe(true)
    resolveFn({ id: 99 })
    await promise
    expect(store.getState().user.loading).toBe(false)
    expect(store.getState().user.user).toEqual({ id: 99 })
  })

  it('dispatches error and logs on rejected API call', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchUser.mockRejectedValue(new Error('boom'))
    const store = makeStore()
    await store.dispatch(fetchUser() as any)

    expect(store.getState().user).toEqual({
      loading: false,
      user: null,
      errorMessage: 'boom',
    })
    expect(errSpy).toHaveBeenCalled()
  })
})
