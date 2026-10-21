import * as Contacts from 'expo-contacts'
import { normalizePhoneNumber, formatPhoneNumber } from '@pegasus/domain'

// ---------------------------------------------------------------------------
// Phone address book → Labor import candidates.
//
// Every number is normalised with the same domain rule the API uses, so the
// import screen can tell which contacts are already in the list and the API
// never sees a number it would reject. Numbers that won't normalise (short
// codes, extensions-only, foreign without a "+") are dropped; a contact left
// with none isn't offered at all.
// ---------------------------------------------------------------------------

export type ContactsAccess = 'all' | 'limited' | 'denied'

export interface ContactNumber {
  label: string
  e164: string
  display: string
}

export interface ContactCandidate {
  id: string
  name: string
  email: string | null
  numbers: ContactNumber[]
}

export interface ContactsLoadResult {
  access: ContactsAccess
  /** False once the OS will no longer show the prompt — send the user to Settings. */
  canAskAgain: boolean
  contacts: ContactCandidate[]
}

const MOBILE_LABEL = /mobile|cell|iphone/i

/** Ask (if needed) and read the address book. */
export async function loadPhoneContacts(): Promise<ContactsLoadResult> {
  let perm = await Contacts.getPermissionsAsync()
  if (!perm.granted && perm.canAskAgain) perm = await Contacts.requestPermissionsAsync()
  if (!perm.granted) return { access: 'denied', canAskAgain: perm.canAskAgain, contacts: [] }

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
    sort: Contacts.SortTypes.FirstName,
  })
  return {
    access: perm.accessPrivileges === 'limited' ? 'limited' : 'all',
    canAskAgain: perm.canAskAgain,
    contacts: toCandidates(data),
  }
}

/** Exported for tests. */
export function toCandidates(contacts: readonly Contacts.ExistingContact[]): ContactCandidate[] {
  const out: ContactCandidate[] = []
  for (const c of contacts) {
    const numbers = contactNumbers(c)
    if (!numbers.length) continue
    const name = (c.name ?? '').trim() || numbers[0]!.display
    out.push({
      id: c.id,
      name,
      email: c.emails?.find((e) => e.email?.trim())?.email?.trim() ?? null,
      numbers,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The contact's valid numbers, de-duplicated, the mobile one first. */
function contactNumbers(c: Contacts.ExistingContact): ContactNumber[] {
  const seen = new Set<string>()
  const numbers: ContactNumber[] = []
  for (const p of c.phoneNumbers ?? []) {
    const raw = p.number ?? p.digits
    if (!raw) continue
    let e164: string
    try {
      e164 = normalizePhoneNumber(raw)
    } catch {
      continue
    }
    if (seen.has(e164)) continue
    seen.add(e164)
    const entry = { label: p.label || 'phone', e164, display: formatPhoneNumber(e164) }
    if (MOBILE_LABEL.test(entry.label)) numbers.unshift(entry)
    else numbers.push(entry)
  }
  return numbers
}
