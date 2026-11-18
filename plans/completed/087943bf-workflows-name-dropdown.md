# tenant-web /workflows: name filter becomes a dropdown

- **Branch:** `fix/workflows-name-dropdown`. Follow-up to #974
  (`plans/completed/92d35285-tenant-web-workflows-section.md`).
- **Status:** Approved by Steve 2026-11-18 ("yes, make the dropdown change"). Done.

## Problem

On QA (Dolios), searching "order" on `/workflows` showed nothing. Two causes:
the tenant has no durable (`kind=WORKFLOW`) versions or instances at all, and
the name box was free text against an API filter that matches a Workflow name
**exactly**, so a partial name could never match even when instances exist.

## Change (tenant-web only; no API / SDK change)

- The "Workflow name" text box becomes a "Workflow" `<select>`: "All
  Workflows" plus the tenant's published durable Workflow names (from
  `GET /workflows`, `kind === 'WORKFLOW'`, deduped and sorted), plus any name on
  a listed instance (a name whose versions are all retired still has
  instances). Choosing one applies at once and clears the key.
- The key box stays free text, enabled once a Workflow is chosen; "Find"
  (was "Apply") applies it.
- With no durable Workflows published, the select is disabled and the page says
  "No durable Workflows are published in this tenant yet".

## Rejected

- Substring match on the API (`nameContains`): needs an API param, OpenAPI and
  an SDK change, and still lets a typo find nothing.

## Checklist

- [x] RTL: options = durable names only; choosing applies; key + Find; Open/All;
      back to "All Workflows" drops name + key; instance-only name kept;
      none-published message.
- [x] tenant-web suite, typecheck, lint.
- [x] DECISIONS note on the #974 entry.
