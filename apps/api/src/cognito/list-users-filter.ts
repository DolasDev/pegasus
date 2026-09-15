// ---------------------------------------------------------------------------
// ListUsers filter values are a quoted mini-language, not parameterised: per the
// API reference, "Quotation marks within the filter string must be escaped using
// the backslash (\) character". Callers pass emails that came from an IdP or an
// admin form, so they get escaped rather than trusted.
// ---------------------------------------------------------------------------
export function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
