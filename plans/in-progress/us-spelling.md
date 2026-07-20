# Standardize the repo on US spelling

Follow-up to #480, which fixed "organisation" in the tenant login copy. That
exposed the wider inconsistency: the repo is written in British English
throughout while the product UI should read as US English.

## Scope

Two spelling families, ~1,100 sites:

- `-ise / -isation` — organise, recognise, authorise, normalise, serialise,
  initialise, optimise, prioritise, utilise, summarise, minimise, maximise,
  specialise, visualise, centralise, sanitise, capitalise, modernise, …
- `-our / -re / -ce / double-L / misc` — behaviour, colour, labour, favour,
  honour, centre, licence, defence, grey, catalogue, analogue, enrolment,
  fulfilment, judgement, acknowledgement, labelled, signalling, cancelling

Applies to prose, comments, docstrings, markdown, test descriptions, test
function names, user-facing UI strings, log/error messages, and purely local
variables.

## Explicitly OUT of scope — these are contracts, not prose

1. **`CANCELLED` / `'cancelled'` status values.** A Postgres enum value in
   `MoveStatus` and the workflow-execution status, documented in the public SDK
   README as a wire value external consumers match on, and mirrored in the
   mobile `OrderStatus` union, the `@pegasus/theme` colour key, and
   `StatusBadge`. Renaming needs an `ALTER TYPE` migration plus an SDK major
   bump, and breaks partners silently. User decision: leave as-is.
   - Prose "cancelled"/"cancelling" in comments and docs → "canceled"/"canceling"
   - Display labels (`cancelled: 'Cancelled'` → `'Canceled'`) → changed
   - The identifiers themselves → untouched
2. **`package-lock.json` / `package.json` dependency names.** Third-party
   packages: `@babel/helper-optimise-call-expression`, `minimist`. A naive
   `minimis→minimiz` corrupts `minimist`. Lockfile excluded outright.
3. **Any DB column, Prisma field, API field, OpenAPI property, or Cedar
   action/entity name.** Survey confirmed none currently contain a British
   spelling — every Prisma/SQL hit is a comment — so this is a guard against
   regression, not a change.
4. **`node_modules`, `dist`, `.git`, build output.**

## Approach

1. Apply an explicit stem→stem replacement table (not a generic `s/ise/ize/`,
   which mangles `analysis`, `emphasis`, `precise`, `wise`, `merchandise`).
2. Preserve case per-occurrence: `Normalise`→`Normalize`, `normalise`→`normalize`.
3. Guard `CANCELLED`/`cancelled` identifiers by handling that word separately
   from the bulk table.
4. Review the complete diff by hand before committing — this is the real gate;
   a mechanical sweep of this size hides its mistakes in the volume.

## Verification

- `npm test` — full suite across all packages (the 1,077-test tenant-web suite
  plus domain/api/infra) must stay green. Test _descriptions_ change; test
  _outcomes_ must not.
- `npm run typecheck` — catches any identifier renamed on one side only.
- `npm run lint`.
- Python: `apps/services`, `apps/tenant-runner`, `apps/temporal-worker`, and the
  SDK have their own test suites — renamed test functions must still collect.
- Targeted greps for each excluded term proving it survived:
  `grep -rn "CANCELLED" apps/api/prisma/schema.prisma` still returns the enum.
- `git diff --stat` reviewed file-by-file before commit.

## Risk

Medium — low per-site, but high volume. The danger is not any single edit; it is
a stray match inside an identifier that typechecks on both sides (e.g. a local
renamed consistently but referenced in a template string). Mitigated by reading
the whole diff and by the full test + typecheck gate.
