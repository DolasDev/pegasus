import { createSlice } from "@reduxjs/toolkit";

const navSlice = createSlice({
  name: "nav",
  initialState: {
    loading: false,
    visible: true
  },
  reducers: {
    toggleNav(state, action) {
      state.visible = !state.visible;
    }
  }
});

export const { toggleNav } = navSlice.actions;

export default navSlice.reducer;
