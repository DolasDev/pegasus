// ---------------------------------------------------------------------------
// Email normalisation — shared by every login boundary (tenant-web + mobile).
//
// Cognito usernames/aliases are case-sensitive, and the backend stores and
// looks up users by their lower-cased email. Any email the user types must be
// trimmed and lower-cased before it is sent to Cognito or the API, otherwise a
// "Steve@Acme.com" login fails against a "steve@acme.com" account.
// ---------------------------------------------------------------------------

/** Trims surrounding whitespace and lower-cases an email for auth calls. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
