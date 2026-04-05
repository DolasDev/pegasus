import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface NavState {
  loading: boolean;
  visible: boolean;
}

const navSlice = createSlice({
  name: "nav",
  initialState: {
    loading: false,
    visible: true
  } as NavState,
  reducers: {
    toggleNav(state, _action: PayloadAction<void>) {
      state.visible = !state.visible;
    }
  }
});

export const { toggleNav } = navSlice.actions;

export default navSlice.reducer;
