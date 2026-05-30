/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Regression guard for the driver-planning Tailwind-Preflight parity fix.
//
// The feature is a port of the (now-removed) apps/longhaul app, which had no
// CSS reset. tenant-web's Tailwind v4 Preflight strips heading + paragraph
// metrics (margin:0; font-size/weight:inherit), which silently broke the port:
// the Trip-itinerary gantt's fixed column fell out of row-alignment and every
// bare <hN>/<p> rendered at body size. styles.css restores those UA defaults
// scoped to .driver-planning-root via zero-specificity :where() selectors.
//
// This is a content assertion, not a render test — it exists so the fix can't
// be silently "tidied away" by someone unaware of the Preflight dependency.
// If it fails, read dolas/agents/project/GOTCHAS.md ("Ported longhaul CSS
// relies on browser-default headings that Tailwind Preflight strips") before
// deleting any rule it checks for.
//
// `?raw` imports of .css come back empty under Vitest's CSS handling, so read
// the file directly. Vitest runs with cwd = this package root (apps/tenant-web).
// ---------------------------------------------------------------------------

const css = readFileSync('src/features/driver-planning/styles.css', 'utf8')

describe('driver-planning styles.css — Preflight parity guard', () => {
  it.each(['h2', 'h3', 'h4', 'h5', 'h6'])('keeps the scoped UA-default restore for <%s>', (tag) => {
    // e.g. ":where(.driver-planning-root) :where(h3)" — zero specificity so it
    // beats Preflight (unlayered) but defers to component heading styles.
    const rule = new RegExp(String.raw`:where\(\.driver-planning-root\)\s*:where\(${tag}\)`)
    expect(css).toMatch(rule)
  })

  it('keeps the scoped <p> margin restore', () => {
    expect(css).toMatch(/:where\(\.driver-planning-root\)\s*:where\(p\)/)
  })

  it('keeps the feature font-family (Open Sans) on .driver-planning-root', () => {
    // longhaul forced Open Sans on body/*; the port re-declares it here.
    const block = css.slice(css.indexOf('.driver-planning-root {'))
    expect(block).toMatch(/font-family:\s*['"]?Open Sans['"]?/i)
  })
})
