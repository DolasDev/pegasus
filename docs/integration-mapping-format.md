# Integration Mapping Format

How to author the **legacy-order → canonical** mapping for an integration (the
input half of the validation endpoint — see
[`integration-validation-endpoint.md`](./integration-validation-endpoint.md)).

## The shape: output-shaped templates

A mapping document is a JSON object whose **shape mirrors the canonical output**.
Each leaf says where its value comes from in the incoming (legacy) order:

```jsonc
{
  "id": { "$from": "id", "coerce": "toNumberOrNull", "default": null },
  "status": {
    "id": { "$from": ["TripStatus_id", "status.status_id"], "coerce": "toNumber", "default": 1 },
    "name": { "$from": "status.status", "default": null },
  },
  "shipments": {
    "$from": "shipments",
    "$each": { "orderNum": { "$from": "order_num", "coerce": "toNumberOrNull" } },
  },
}
```

### Leaf forms

| Form                                | Meaning                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `"field": "source.path"`            | shorthand — copy `source.path` from the input as-is                                 |
| `"field": { "$from": … }`           | a **directive** (use when you need a fallback, default, coercion, or array mapping) |
| `"field": { "subA": …, "subB": … }` | a **nested** canonical object (its keys are output fields)                          |

### Directive keys

- **`$from`** — source path, or an array of paths as a fallback chain (first one
  that resolves wins). Required.
- **`default`** — value used when no `$from` path resolves.
- **`coerce`** — one of `toNumber`, `toNumberOrNull`, `toString`, `identity`,
  `toDateOnly`, `toIsoDateTime`. Applied **after** `$map`.
- **`$map`** — a finite value-translation table, `{ "<source value>": <scalar> }`.
  Scalar leaves only (never with `$each`). A **hit** yields the mapped value; a
  **miss** falls back to `default` when one is declared, else passes the source
  value through — so declaring a `default` alongside `$map` rewrites every
  unlisted value too. Runs **before** `coerce`. When the target field is an enum in
  the canonical contract, the static checker validates the table's outputs against
  it.
- **`$each`** — for an array target: a sub-template applied to each source element
  (`$from` points at the source array; `$each` maps each element).

Field names may not start with `$` (that namespace is reserved for directives).

### Dates

Partners usually document their own date format while the legacy source emits
.NET-serialized datetimes (`2026-07-16T00:00:00`), so two coercions reformat them:

| Coercion        | `2026-08-10T17:06:13.093` → | `2026-07-16` →        |
| --------------- | --------------------------- | --------------------- |
| `toDateOnly`    | `2026-08-10`                | `2026-07-16`          |
| `toIsoDateTime` | `2026-08-10T17:06:13`       | `2026-07-16T00:00:00` |

Both are **wall-clock truncations, never timezone conversions**: the calendar
fields are re-emitted exactly as serialized and a trailing `Z`/offset is dropped
rather than applied, so the day can never shift. Both are **null-safe** — `null`,
an absent path, `""`, and any unparseable or non-existent date (`2026-02-30`) each
yield `null`, never `Invalid Date`, `1970-01-01`, or a throw.

Because `coerce` runs after `$map`, one leaf handles both the .NET min-date
sentinel and the format:

```jsonc
"surveyDate": {
  "$from": "KeyMoveDates.Survey.Planned",
  "$map": { "0001-01-01T00:00:00": null }, // sentinel → null …
  "coerce": "toDateOnly",                  // … everything else → YYYY-MM-DD
}
```

Note what the pipeline does **not** check: the canonical contract types these
fields as generic dates, so nothing compares the emitted string against the
_partner's_ documented format. Getting the format right is the config author's
call, and the coercion is what makes it expressible.

### Not an expression language

This format is deliberately bounded — no conditionals, functions, or arithmetic.
That keeps every mapping diffable per-leaf, statically checkable, and safe for an
AI to edit one field at a time. If a single field genuinely needs logic a template
can't express, that's the documented escape hatch for a CEL/JSONata expression —
raise it rather than working around the format.

## Why this guarantees valid mappings

Validity comes from three mechanical layers, not from a library:

1. **Format** — the document is validated against the published JSON Schema
   (below). Ill-formed mappings fail immediately.
2. **Target** — every field the mapping produces must exist in the integration's
   **canonical contract** (`analyzeMapping` checks produced paths against
   `z.toJSONSchema(structuralContract)`). You cannot map to a field the validator
   doesn't know.
3. **Input** — every top-level `$from` must be a declared input field root (a typo
   guard), when the integration declares `inputFieldRoots`.

The runtime additionally validates the actual **output** against the canonical
contract on every call (and the golden corpus pins behavior). The static checker
is the pre-flight; CI runs it for every registered integration
(`mapping-static-check.test.ts`).

`$from` source paths follow **JSONPath**-style dotted access (a subset of
[RFC 9535](https://www.rfc-editor.org/rfc/rfc9535)).

## The published schema — where to get it

The mapping-format JSON Schema (draft 2020-12) is published two ways, kept in sync
by a test:

- **Live endpoint (no auth):**
  `GET {API_BASE_URL}/api/v1/integrations/mapping-schema`
- **In repo:** [`docs/schemas/integration-mapping.schema.json`](./schemas/integration-mapping.schema.json)

`$id`: `https://pegasus.dolas.dev/schemas/integration-mapping/v3.json`. Point your
editor's `$schema` at either source for live validation while authoring. Bump the
version on a format change consumers must notice — a directive is `.strict()` and
`coerce` is a closed enum, so an older validator **rejects** a document using
newer machinery rather than silently ignoring it (v2 added `$map`; v3 added the
date coercions). The schema carries per-directive `description`s, so fetching it is
the self-serve way to read this contract without the source.

## Adding an integration (checklist)

1. Define the canonical model for it (the structural contract, a Zod schema).
2. Author the mapping document in this format.
3. Declare its `inputFieldRoots` (the legacy DTO's top-level keys).
4. Register it in `apps/api/src/integration-validation/registry.ts` — the registry
   compiles the mapping to the engine spec.
5. `mapping-static-check.test.ts` validates it automatically. Green = guaranteed
   well-formed, on-contract, and typo-free.

Worked reference: `apps/api/src/integration-validation/transform/longhaul.transform.ts`.
