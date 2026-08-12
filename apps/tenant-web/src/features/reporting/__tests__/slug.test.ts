// ---------------------------------------------------------------------------
// Slug derivation for a NEW dashboard.
//
// The disambiguation is the point: publishing to an existing slug is a new
// VERSION of that lineage — correct when editing, destructive when creating.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { slugify, uniqueSlug } from '@/routes/reporting.edit'

describe('slugify', () => {
  it('lowercases and kebab-cases a title', () => {
    expect(slugify('Operations Overview')).toBe('operations-overview')
  })

  it('collapses punctuation and trims separators', () => {
    expect(slugify('  Q3 — Revenue & Margin!  ')).toBe('q3-revenue-margin')
  })

  it('returns empty for a title with nothing sluggable', () => {
    // The caller treats this as "give it a title first" rather than publishing
    // under a meaningless slug.
    expect(slugify('!!!')).toBe('')
  })

  it('matches the API’s kebab-case rule', () => {
    const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
    expect(SLUG_RE.test(slugify('Moves by Status (90d)'))).toBe(true)
  })
})

describe('uniqueSlug', () => {
  it('returns the base when nothing has claimed it', () => {
    expect(uniqueSlug('ops', ['other'])).toBe('ops')
  })

  it('disambiguates rather than superseding an existing dashboard', () => {
    // Without this, titling a new dashboard "Operations overview" would publish
    // v2 of the team's existing one and silently replace it for everyone whose
    // default points at that slug.
    expect(uniqueSlug('ops', ['ops'])).toBe('ops-2')
  })

  it('keeps counting past an already-disambiguated slug', () => {
    expect(uniqueSlug('ops', ['ops', 'ops-2', 'ops-3'])).toBe('ops-4')
  })

  it('passes an empty base straight through', () => {
    expect(uniqueSlug('', ['ops'])).toBe('')
  })
})
