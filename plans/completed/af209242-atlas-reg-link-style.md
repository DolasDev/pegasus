# fix: style the Atlas reg-number link like the Order Number link above it

## Problem

`#565` made the **Reg Number** row in the Operations shipment-details pane an
`<a href>` to Atlas, but it renders as plain body text — not the blue underlined
link the user expects.

Cause: tenant-web loads Tailwind v4 (`src/globals.css` → `@import "tailwindcss"`),
whose preflight resets anchors to `a { color: inherit; text-decoration: inherit }`.
So the UA's default link styling never applies. There is no other global anchor
rule in the app.

The **Order Number** link directly above it doesn't hit this because it is not an
anchor at all — it's the `Clickable` component (a `<div>`), styled by
`components/Clickable/Clickable.module.css`:

```css
.clickable {
  color: -webkit-link;
  cursor: pointer;
  text-decoration: underline;
  display: inline;
}
```

## Change

Apply that same `.clickable` class to the Atlas anchor, importing the existing
`Clickable.module.css` rather than copying its declarations into
`ShipmentDetail.module.css` — one source of truth, so the two links in the pane
can't drift apart visually.

File: `apps/tenant-web/src/features/driver-planning/containers/ShipmentDetail/index.tsx`

The anchor keeps everything it already has: the Atlas href, `title="open in
Atlas"`, `target="_blank"`, `rel="noopener noreferrer"`, `data-target="atlas-reg-link"`,
and the blank-reg degrade.

## Tests

Extend the existing Atlas-link case in
`.../ShipmentDetail/index.test.tsx` to assert the anchor carries the shared
clickable class, so a future refactor that drops the styling fails the suite.

## Non-goals

- No change to `Clickable` itself or to the Order Number row.
- Not restyling the Trip Id `<Link>` (same preflight effect, but out of scope
  for this request).
- No global anchor rule / preflight override — that would be a repo-wide visual
  change well beyond this ask.
