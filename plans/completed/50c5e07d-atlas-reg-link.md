# feat: Reg Number links to Atlas webdispatch

## Goal

In the Operations screen's **Shipment Details** pane, render the **Reg Number**
value as a link to Atlas web dispatch instead of plain text:

```
https://atlasnet.atlasworldgroup.com/webdispatch/editshipment/<reg number>
```

e.g. reg number `RC086240` → `.../webdispatch/editshipment/RC086240`.

The link carries the tooltip **"open in Atlas"**.

## Where

`apps/tenant-web/src/features/driver-planning/containers/ShipmentDetail/index.tsx`
— the field entry `{ accessor: 'avl_reg', label: 'Reg Number' }` (index.tsx:71-74).
The value comes off the enriched shipment row as `avl_reg` (confirmed by the
existing test fixture `avl_reg: 'REG-001'`).

## Changes

1. Swap the plain string accessor for a function accessor that renders an
   `<a>` with:
   - `href` = `https://atlasnet.atlasworldgroup.com/webdispatch/editshipment/${encodeURIComponent(avl_reg)}`
   - `title="open in Atlas"` (native tooltip, matching how the rest of this
     ported pane does hover text)
   - `target="_blank"` + `rel="noopener noreferrer"` — the existing external-link
     convention in tenant-web (`routes/settings.developer.tsx`,
     `routes/settings.integrations.ringcentral.tsx`).
   - a `data-target` hook so tests/e2e don't DOM-walk.
2. Degrade to blank (no link, no `undefined` in the href) when `avl_reg` is
   absent or empty — consistent with the `joinPresent` hardening already in this
   file for other ported accessors.

## Tests

`apps/tenant-web/src/features/driver-planning/containers/ShipmentDetail/index.test.tsx`:

- Reg Number renders as an anchor with the exact Atlas href for the fixture's
  `avl_reg`, and with `title="open in Atlas"` + `target="_blank"` +
  `rel="noopener noreferrer"`.
- A shipment with no `avl_reg` renders no Atlas link (and no `.../undefined` href).

## Non-goals

- No API/domain change — `avl_reg` already ships on the row.
- No change to any other field in the pane.
- Atlas base URL is hard-coded (as specified); no new config surface.
