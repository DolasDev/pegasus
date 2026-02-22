# Code Patterns & Conventions

- **Branded IDs Everywhere**: Never accept generic `string` where a domain ID is expected. Always use the `Brand<T, B>` pattern and the generated `to*Id` factories.
- **Immutable Value Objects**: All interfaces must use `readonly` on every field. Never mutate state; return new objects.
- **Factory Functions**: Prefer `createX(input): X` over classes or direct object instantiation to perform validation logic safely.
- **Barrel Files**: Each bounded context folder (e.g. `customer/`, `dispatch/`) has an `index.ts` that re-exports its public surface.
- **Type Imports**: Always use `import type { ... }` for type-only imports to keep runtime bundles clean.
- **Named Exports Only**: Using default exports is strictly discouraged; this improves refactoring safety and searchability.
- **Strict TypeScript**: `tsconfig.base.json` enforces `strict: true` project-wide. The `any` type is forbidden, and type assertions (`as`) are only permitted within factory `to*Id` wrapper functions.
- **Domain Purity**: Limit all domain functions to pure side-effect-free executions. Do not introduce I/O, database dependencies, or React components in `packages/domain`.
