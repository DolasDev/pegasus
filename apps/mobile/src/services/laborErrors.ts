// ---------------------------------------------------------------------------
// Legible text for the labor API's refusals. The API puts a stable `code` on
// every error (ApiError.code); the server's message is fine for a developer
// but the drivers and Operations users reading the alert need to be told what
// to do next. Anything unrecognised falls back to the server's own message.
// ---------------------------------------------------------------------------

const BY_CODE: Record<string, string> = {
  CREW_NOT_IN_YOUR_LIST: 'Add this crew to your own list first.',
  OPERATIONS_ONLY: 'Only Operations can do this.',
  LINK_RATE_LIMITED: 'You’ve added the most crews allowed for today. Try again tomorrow.',
}

export function laborErrorMessage(err: unknown, fallback = 'Please try again.'): string {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && BY_CODE[code]) return BY_CODE[code]
  return err instanceof Error && err.message ? err.message : fallback
}
