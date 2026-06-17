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
- **`coerce`** — one of `toNumber`, `toNumberOrNull`, `toString`, `identity`.
- **`$each`** — for an array target: a sub-template applied to each source element
  (`$from` points at the source array; `$each` maps each element).

Field names may not start with `$` (that namespace is reserved for directives).

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

`$id`: `https://pegasus.dolas.dev/schemas/integration-mapping/v1.json`. Point your
editor's `$schema` at either source for live validation while authoring. Bump the
`v1` on a breaking format change.

## Adding an integration (checklist)

1. Define the canonical model for it (the structural contract, a Zod schema).
2. Author the mapping document in this format.
3. Declare its `inputFieldRoots` (the legacy DTO's top-level keys).
4. Register it in `apps/api/src/integration-validation/registry.ts` — the registry
   compiles the mapping to the engine spec.
5. `mapping-static-check.test.ts` validates it automatically. Green = guaranteed
   well-formed, on-contract, and typo-free.

Worked reference: `apps/api/src/integration-validation/transform/longhaul.transform.ts`.
