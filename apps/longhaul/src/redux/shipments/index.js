import { createSlice } from "@reduxjs/toolkit";
import { cloneDeep } from 'lodash';
import { API } from "../../utils/api";

const getDateOffset = (offsetDays) => {
  const today = new Date();
  today.setDate(today.getDate() + offsetDays)
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  const yyyy = today.getFullYear();
  const offsetDate = yyyy + '-' + mm + '-' + dd;
  return(offsetDate);
}

const DEFAULT_QUERY = {
  searchTerm: "",
  filters: {
    Is_Trip_Planning: true,
    load_date: [ getDateOffset(-30), getDateOffset(30) ],
    assigned:[
      {label: "No", value: "No"}
    ]
  },
  sortBy: {}
};

const shipmentsSlice = createSlice({
  name: "shipments",
  initialState: {
    loading: false,
    loadingSelectedShipment: false,
    selectedShipment: null,
    shipmentList: [],
    query: cloneDeep(DEFAULT_QUERY),
    haulModes: [], // populates haulModes filter options
    pegasus_shadow: {},
    error: false
  },
  reducers: {

    saveShipmentCoverage(state, action) {
      const shipmentCoverageDto = action.payload;
      const shipmentIndexInList = findWithAttr(state.shipmentList, 'order_num', shipmentCoverageDto.order_num)
      if(state.shipmentList[shipmentIndexInList]?.packing_coverage){
        state.shipmentList[shipmentIndexInList].packing_coverage = shipmentCoverageDto
      }
      API.saveShipmentCoverage(shipmentCoverageDto)
    },

    patchShipmentShadow(state, action) {
      const shipmentShadowDto = action.payload;
      const shipmentIndexInList = findWithAttr(state.shipmentList, 'order_num', shipmentShadowDto.order_num)
      if(state.shipmentList[shipmentIndexInList]?.pegasus_shadow){
        state.shipmentList[shipmentIndexInList].pegasus_shadow = {...state.shipmentList[shipmentIndexInList].pegasus_shadow, ...shipmentShadowDto}
      }
      API.patchShipmentShadow(shipmentShadowDto)
    },

    changeShipmentQuery(state, action) {
      state.query = {
        ...state.query,
        ...action.payload
      };
    },

    resetToDefaultShipmentQuery(state) {
      state.query = cloneDeep(DEFAULT_QUERY);
    },

    fetchShipmentsStart(state, action) {
      state.loading = true;
    },
    fetchShipmentsSuccess(state, action) {
      state.shipmentList = action.payload;
      state.loading = false;
    },
    fetchShipmentsFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    fetchShipmentStart(state, action) {
      state.loadingSelectedShipment = true;
    },
    fetchShipmentSuccess(state, action) {
      state.selectedShipment = action.payload;
      state.loadingSelectedShipment = false;
    },
    fetchShipmentFailure(state, action) {
      state.loadingSelectedShipment = false;
      state.error = action.payload;
    },
  }
});

export const {
  fetchShipmentsSuccess,
  fetchShipmentsFailure,
  fetchShipmentsStart,
  fetchShipmentSuccess,
  fetchShipmentFailure,
  fetchShipmentStart,
  changeShipmentQuery,
  saveShipmentCoverage,
  patchShipmentShadow,
  resetToDefaultShipmentQuery,
} = shipmentsSlice.actions;

function findWithAttr(array, attr, value) {
  for(var i = 0; i < array.length; i += 1) {
      if(array[i][attr] === value) {
          return i;
      }
  }
  return -1;
}

export const fetchShipments = (query) => async dispatch => {
  try {
    dispatch(fetchShipmentsStart());
    const shipments = await API.fetchShipments(query);
    dispatch(fetchShipmentsSuccess(shipments));
  } catch (e) {
    console.error(`Error fetching shipments`, e);
    dispatch(fetchShipmentsFailure(e.message));
  }
};

export const selectShipment = (selectedShipment) => async dispatch => {
  if (
    !selectedShipment
  ){
    dispatch(fetchShipmentSuccess(null));
  } 
  else {
    try {
      dispatch(fetchShipmentStart());
      const shipment = await API.fetchShipments({searchTerm: String(selectedShipment.order_num)});
      dispatch(fetchShipmentSuccess(shipment[0]));
    } catch (e) {
      console.error(`Error fetching shipment`, e);
      dispatch(fetchShipmentFailure(e.message));
    }
  }
};

export const loadDefaultFilter = (userCode) => async (dispatch, state) => {
  try {
    const response = await API.fetchShipmentDefaultFilterForUser();
    if (response) {
      dispatch(changeShipmentQuery(JSON.parse(response.query)));
    }
  } catch (e) {
    console.error(e);
  }
}

export const deleteShipmentFilter = (id) => async (dispatch) => {
  try {
    const response = await API.deleteShipmentFilter(id);
    if (response) {
      dispatch(changeShipmentQuery(JSON.parse(response.query)));
    }
  } catch (e) {
    console.error(e);
  }
}

export default shipmentsSlice.reducer;
