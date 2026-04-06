# Upgrade Zod 3 → 4

## Summary

Zod 4 is a major release with API changes. Currently on `zod@^3.25.76` across `apps/api`.

## Scope

- Evaluate Zod 4 breaking changes (schema API, error formatting, inference)
- Migrate all Zod schemas in `apps/api/src/` (handlers, validators, env config)
- Update `@pegasus/domain` if any Zod schemas exist there
- Verify all tests pass after migration

## References

- Dependabot PR #2 (closed — needs planned migration)
- https://zod.dev/v4

## Status

Not started.
