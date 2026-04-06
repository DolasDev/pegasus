# Upgrade Prisma 6 → 7

## Summary

Prisma 7 is a major release with changes to client generation and query engine. Currently on `prisma@^6.19.3` / `@prisma/client@^6.0.0` in `apps/api`.

## Scope

- Evaluate Prisma 7 breaking changes (client generation, query API, migration engine)
- Update `prisma` and `@prisma/client` in `apps/api/package.json`
- Fix `prisma generate` — v7 changed client resolution (CI already failing on this)
- Update schema.prisma if needed for new syntax
- Re-run all integration tests against local Postgres
- Update CDK Lambda bundling if Prisma engine files changed

## References

- Dependabot PR #3 (closed — `prisma generate` fails with v7)
- https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7

## Status

Not started.
