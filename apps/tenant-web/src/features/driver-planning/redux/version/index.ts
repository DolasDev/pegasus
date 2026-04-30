import { API } from '../../utils/api'
import { createSlice, type Dispatch } from '@reduxjs/toolkit'

const versionSlice = createSlice({
  name: 'version',
  initialState: {
    loading: false,
    release_channel: null,
    clientVersion: null,
    serverVersion: null,
    supportedVersions: [],
    errorMessage: null,
  },
  reducers: {
    fetchVersionStart(state) {
      state.errorMessage = null
      state.loading = true
    },
    fetchVersionSuccess(state, action) {
      state.loading = false
      state.clientVersion = action.payload.clientVersion
      state.supportedVersions = action.payload.supportedVersions.map(
        (result: any) => result.supported_client_version,
      )
      state.serverVersion = action.payload.supportedVersions.map(
        (result: any) => result.database_version,
      )[0]
      state.release_channel = action.payload.release_channel
    },
    fetchVersionError(state, action) {
      state.serverVersion = null
      state.loading = false
      state.errorMessage = action.payload
    },
  },
})

export default versionSlice.reducer

type Version = any // TODO define shared type;

export const fetchVersion = () => async (dispatch: Dispatch) => {
  const { fetchVersionStart, fetchVersionSuccess, fetchVersionError } = versionSlice.actions
  try {
    dispatch(fetchVersionStart())
    const version: Version = await API.fetchVersion()
    dispatch(fetchVersionSuccess(version))
  } catch (e) {
    console.error(e)
    dispatch(fetchVersionError((e as any).message))
  }
}
