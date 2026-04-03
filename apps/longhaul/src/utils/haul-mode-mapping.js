export const haulModeMapping = {
  Y: "self",
  N: "avl",
  O: "other",
  U: "undecided",
  P: "pending"
};

export const sHaulMapping = {
  Y: "yes",
  N: "no"
};

export const haulModeOptions = Object.keys(haulModeMapping).map(key => ({
  [key]: haulModeMapping[key]
}));

export const sHaulOptions = Object.keys(sHaulMapping).map(key => ({
  [key]: sHaulMapping[key]
}));
