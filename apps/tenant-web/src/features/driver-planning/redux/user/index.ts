import { API } from '../../utils/api'
import { createSlice, type Dispatch } from '@reduxjs/toolkit'

const userSlice = createSlice({
  name: 'user',
  initialState: {
    loading: false,
    user: null,
    errorMessage: null,
  },
  reducers: {
    fetchUserStart(state) {
      state.user = null
      state.errorMessage = null
      state.loading = true
    },
    fetchUserSuccess(state, action) {
      state.loading = false
      state.user = action.payload
    },
    fetchUserError(state, action) {
      state.user = null
      state.loading = false
      state.errorMessage = action.payload
    },
  },
})

export default userSlice.reducer

type User = any // TODO define shared type;

export const fetchUser = () => async (dispatch: Dispatch) => {
  const { fetchUserStart, fetchUserSuccess, fetchUserError } = userSlice.actions
  try {
    dispatch(fetchUserStart())
    const user: User = await API.fetchUser()
    dispatch(fetchUserSuccess(user))
  } catch (e) {
    console.error(e)
    dispatch(fetchUserError((e as any).message))
  }
}
