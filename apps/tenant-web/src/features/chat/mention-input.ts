import { formatMentionToken } from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Composer mentions. The textarea shows a picked mention as plain `@Name`; the
// composer remembers which user each picked name stands for and swaps the
// `@Name` back into the API's `@[Name](userId)` token only when sending. A
// name typed by hand without picking stays plain text — it pages nobody.
// ---------------------------------------------------------------------------

export type PickedMention = { name: string; userId: string }

/**
 * The `@query` being typed at the caret, if any: an `@` at the start or after
 * whitespace, followed by no whitespace up to the caret.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query) || query.length > 50) return null
  return { start: at, query }
}

/** Replaces the `@query` at the caret with `@Name ` and returns the new text + caret. */
export function insertMention(
  text: string,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret)
  const start = active ? active.start : caret
  const inserted = `@${name} `
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The body to send: each `@Name` the user picked becomes its mention token.
 * Longer names match first, so `@Ann Lee` wins over `@Ann`. A name only
 * matches as a whole (followed by the end, whitespace or punctuation).
 */
export function encodeMentions(text: string, picked: readonly PickedMention[]): string {
  const byName = new Map<string, string>()
  for (const p of picked) if (p.name) byName.set(p.name, p.userId)
  if (byName.size === 0) return text
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const pattern = new RegExp(`@(${names.join('|')})(?=$|[\\s.,!?;:)])`, 'g')
  return text.replace(pattern, (_m, name: string) => formatMentionToken(name, byName.get(name)!))
}

/** Candidates whose name contains the query (case-insensitive), at most `limit`. */
export function filterMentionable<T extends { name: string }>(
  candidates: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase()
  return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, limit)
}
