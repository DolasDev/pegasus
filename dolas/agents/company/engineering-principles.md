---
name: dolas-engineering-principles
description: Universal DolasDev engineering principles. Apply to every project and team: plan before code, TDD, non-breaking increments, safety rails, observability, and output standards.
---

# DolasDev Engineering Principles

These principles apply to every project and every engineer at DolasDev. They are **mandatory** — not suggestions.

## Mandatory Pre-Implementation Phase

**No code before plan approval.**

Before writing any code, produce a plan containing:

1. The task restated in your own words.
2. A step-by-step implementation plan.
3. Every file to be modified and every new file to be created.
4. Potential side effects or risks.

Wait for explicit developer approval before implementing anything.

## Test-Driven Development

**Tests are written before the implementation, not after.**

For every feature, endpoint, or component being built:

1. Write the test file first, covering the expected behaviour, error paths, and edge cases.
2. Run the tests and confirm they fail for the right reason (the implementation does not exist yet).
3. Write the minimum implementation needed to make the tests pass.
4. Refactor if necessary, keeping tests green throughout.

**Plans and individual checklist items must reflect this order.** Each step in a plan that introduces new behaviour must list the test file as the item to implement first, with the implementation item immediately following. Example:

```
- [ ] Write tenant-users.test.ts (handler unit tests — all cases failing)
- [ ] Implement tenant-users.ts (make tests pass)
```

Do not merge test and implementation steps into a single checklist item. They are distinct deliverables with a defined sequence.

## Non-Breaking, Independently Deployable Steps

Each increment must leave the codebase deployable:

- No partially-implemented features that break existing behaviour.
- Prefer feature flags, additive changes, and backwards-compatible interfaces.
- Database migrations must be non-destructive (no dropped columns/tables while old code still references them).

## Safety Rails

You MUST NOT:

- Delete large blocks of code without explicit justification in the plan.
- Remove configuration or environment logic.
- Modify the database schema unless explicitly in the approved plan.
- Introduce breaking API changes unless explicitly specified.

## Observability & Logging

When implementing any change, you MUST consider telemetry, tracing, and logging:

- Use structured logging instead of `console.log` or unstructured output.
- Do not leak internal stack traces or sensitive system data to the client in HTTP responses. Catch exceptions, log the full details securely on the server with a correlation ID, and return a sanitized error payload to the client.
- Propagate trace IDs (`x-correlation-id`) from the frontend across network boundaries to the backend for end-to-end traceability.
- Use `error` level for unexpected failures (bugs, infrastructure errors); use `warn` for expected rejections (auth failures, domain rule violations).

## Output Format

When presenting results: show changes clearly (diffs preferred), keep diffs minimal, explain why each change is necessary, and include no unrelated commentary.
