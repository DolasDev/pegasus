import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'

vi.mock('../../utils/api', () => ({
  API: {
    fetchVersion: vi.fn(),
  },
}))

import versionReducer, { fetchVersion } from './index'
import { API } from '../../utils/api'

const mockedApi = API as unknown as { fetchVersion: ReturnType<typeof vi.fn> }

function makeStore() {
  return configureStore({
    reducer: { version: versionReducer },
  })
}

describe('version slice — reducer', () => {
  it('has the expected initial state', () => {
    const store = makeStore()
    expect(store.getState().version).toEqual({
      loading: false,
      release_channel: null,
      clientVersion: null,
      serverVersion: null,
      supportedVersions: [],
      errorMessage: null,
    })
  })

  it('fetchVersionStart sets loading and clears errorMessage', () => {
    const store = configureStore({
      reducer: { version: versionReducer },
      preloadedState: {
        version: {
          loading: false,
          release_channel: null,
          clientVersion: null,
          serverVersion: null,
          supportedVersions: [],
          errorMessage: 'old error',
        } as any,
      },
    })
    store.dispatch({ type: 'version/fetchVersionStart' })
    const state = store.getState().version
    expect(state.loading).toBe(true)
    expect(state.errorMessage).toBeNull()
  })

  it('fetchVersionSuccess maps payload fields', () => {
    const store = makeStore()
    store.dispatch({
      type: 'version/fetchVersionSuccess',
      payload: {
        clientVersion: '1.4.0',
        release_channel: 'stable',
        supportedVersions: [
          { supported_client_version: '1.4.0', database_version: 'db-42' },
          { supported_client_version: '1.3.10', database_version: 'db-41' },
        ],
      },
    })
    const state = store.getState().version
    expect(state.loading).toBe(false)
    expect(state.clientVersion).toBe('1.4.0')
    expect(state.supportedVersions).toEqual(['1.4.0', '1.3.10'])
    expect(state.serverVersion).toBe('db-42')
    expect(state.release_channel).toBe('stable')
  })

  it('fetchVersionError clears serverVersion and stores message', () => {
    const store = configureStore({
      reducer: { version: versionReducer },
      preloadedState: {
        version: {
          loading: true,
          release_channel: 'beta',
          clientVersion: '1.4.0',
          serverVersion: 'db-42',
          supportedVersions: ['1.4.0'],
          errorMessage: null,
        } as any,
      },
    })
    store.dispatch({ type: 'version/fetchVersionError', payload: 'fetch failed' })
    const state = store.getState().version
    expect(state.loading).toBe(false)
    expect(state.serverVersion).toBeNull()
    expect(state.errorMessage).toBe('fetch failed')
  })
})

describe('version slice — fetchVersion thunk', () => {
  beforeEach(() => {
    mockedApi.fetchVersion.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches start then success on resolved API call', async () => {
    mockedApi.fetchVersion.mockResolvedValue({
      clientVersion: '1.4.0',
      release_channel: 'stable',
      supportedVersions: [{ supported_client_version: '1.4.0', database_version: 'db-1' }],
    })
    const store = makeStore()
    await store.dispatch(fetchVersion() as any)

    expect(mockedApi.fetchVersion).toHaveBeenCalledTimes(1)
    const state = store.getState().version
    expect(state.loading).toBe(false)
    expect(state.clientVersion).toBe('1.4.0')
    expect(state.serverVersion).toBe('db-1')
    expect(state.supportedVersions).toEqual(['1.4.0'])
    expect(state.release_channel).toBe('stable')
  })

  it('sets loading=true synchronously before resolution', async () => {
    let resolveFn: (v: any) => void = () => {}
    mockedApi.fetchVersion.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )
    const store = makeStore()
    const p = store.dispatch(fetchVersion() as any)
    expect(store.getState().version.loading).toBe(true)
    resolveFn({
      clientVersion: '1.4.0',
      release_channel: 'stable',
      supportedVersions: [{ supported_client_version: '1.4.0', database_version: 'db-1' }],
    })
    await p
    expect(store.getState().version.loading).toBe(false)
  })

  it('dispatches error on rejected API call', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedApi.fetchVersion.mockRejectedValue(new Error('network down'))
    const store = makeStore()
    await store.dispatch(fetchVersion() as any)

    const state = store.getState().version
    expect(state.loading).toBe(false)
    expect(state.serverVersion).toBeNull()
    expect(state.errorMessage).toBe('network down')
    expect(errSpy).toHaveBeenCalled()
  })
})
