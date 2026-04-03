const LOCAL_DATE = "local-date";
export function formatDate(date, options = {}) {
  const { type = LOCAL_DATE, defaultVal = "" } = options;
  if (type === LOCAL_DATE) {
    let options = {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC"
    };
    return date
      ? new Date(date).toLocaleDateString("en-US", options)
      : defaultVal;
  }
}

export function formatDateShort(date, options = {}) {
  const { type = LOCAL_DATE, defaultVal = "" } = options;
  if (type === LOCAL_DATE) {
    let options = {
      //year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC"
    };
    return date
      ? new Date(date).toLocaleDateString("en-US", options)
      : defaultVal;
  }
}
