interface FormatDateOptions {
  type?: string;
  defaultVal?: string;
}

const LOCAL_DATE = "local-date";
export function formatDate(date: any, options: FormatDateOptions = {}): string | undefined {
  const { type = LOCAL_DATE, defaultVal = "" } = options;
  if (type === LOCAL_DATE) {
    let dateOptions: Intl.DateTimeFormatOptions = {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC"
    };
    return date
      ? new Date(date).toLocaleDateString("en-US", dateOptions)
      : defaultVal;
  }
}

export function formatDateShort(date: any, options: FormatDateOptions = {}): string | undefined {
  const { type = LOCAL_DATE, defaultVal = "" } = options;
  if (type === LOCAL_DATE) {
    let dateOptions: Intl.DateTimeFormatOptions = {
      //year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      timeZone: "UTC"
    };
    return date
      ? new Date(date).toLocaleDateString("en-US", dateOptions)
      : defaultVal;
  }
}
