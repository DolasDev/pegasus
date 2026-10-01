// ---------------------------------------------------------------------------
// Pure helpers for the email allowed-recipient-domains editor. The API is the
// authority (apps/api/src/lib/app-settings.ts rejects anything that isn't a
// bare domain); these only give the admin immediate feedback before saving.
// ---------------------------------------------------------------------------

/** Same shape the API enforces: labels joined by dots, alphabetic TLD. */
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export interface ParsedDomains {
  domains: string[]
  invalid: string[]
}

/** Split on commas/whitespace/newlines, lowercase, drop duplicates, flag invalid entries. */
export function parseDomainList(text: string): ParsedDomains {
  const seen = new Set<string>()
  const domains: string[] = []
  const invalid: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase()
    if (!d || seen.has(d)) continue
    seen.add(d)
    if (DOMAIN.test(d)) domains.push(d)
    else invalid.push(raw.trim())
  }
  return { domains, invalid }
}

export function formatDomainList(domains: readonly string[] | null | undefined): string {
  return (domains ?? []).join('\n')
}
