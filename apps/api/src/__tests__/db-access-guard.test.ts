// ---------------------------------------------------------------------------
// db-access-guard.test.ts — Tenant-isolation static file guards
//
// These tests are PURE FILE SYSTEM scans. They require no database connection,
// no Prisma client, and no environment variables. They run in every environment
// including CI legs without DATABASE_URL.
//
// Guard 1 — Raw-SQL allowlist
//   Ensures that $queryRaw / $executeRaw only appear in the health-check
//   (app.ts). Any new raw-SQL usage must be reviewed and added to the allowlist.
//
// Guard 2 — Base-client (unscoped) handler allowlist
//   Ensures that only known, reviewed handlers import the base (unscoped)
//   Prisma client from '../db'. New imports must be justified and explicitly
//   added to ALLOWED_BASE_CLIENT_HANDLERS.
//
// The base unscoped client bypasses the per-request tenant Prisma extension
// (createTenantDb) used by standard tenant handlers. It is legitimate for
// cross-tenant operations (admin, auth, crons, longhaul) but should never
// silently appear in new handlers that ought to use `c.get('db')`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all .ts files under `dir`. Returns absolute paths.
 * Skips __tests__, node_modules, and dist directories.
 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = []

  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        // Skip __tests__ directories and node_modules
        if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist')
          continue
        walk(abs)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        results.push(abs)
      }
    }
  }

  walk(dir)
  return results
}

// Resolve paths relative to this test file.
// __dirname = apps/api/src/__tests__
const srcDir = join(__dirname, '..')
const handlersDir = join(srcDir, 'handlers')

// ---------------------------------------------------------------------------
// Guard 1: Raw SQL ($queryRaw / $executeRaw)
// ---------------------------------------------------------------------------

/**
 * ALLOWED_RAW_SQL_FILES — files (relative to apps/api/src/) that are
 * permitted to use $queryRaw or $executeRaw.
 *
 * Currently the only legitimate use is the SELECT 1 health check in app.ts.
 * If a new file needs raw SQL, add it here with a justification comment and
 * open a security review — raw SQL bypasses Prisma's model-level tenant
 * extension entirely.
 */
const ALLOWED_RAW_SQL_FILES: ReadonlySet<string> = new Set([
  'app.ts', // Health check: SELECT 1 for /health?deep=true
])

describe('Guard 1: Raw SQL usage ($queryRaw / $executeRaw)', () => {
  it('only allowed files contain $queryRaw or $executeRaw', () => {
    const rawSqlRegex = /\$queryRaw|\$executeRaw/

    const allSrcFiles = collectTsFiles(srcDir)
    const violators: string[] = []

    for (const absPath of allSrcFiles) {
      const content = readFileSync(absPath, 'utf-8')
      if (rawSqlRegex.test(content)) {
        // Normalise to src-relative path using forward slashes for
        // cross-platform determinism.
        const rel = relative(srcDir, absPath).split(sep).join('/')
        if (!ALLOWED_RAW_SQL_FILES.has(rel)) {
          violators.push(rel)
        }
      }
    }

    const sorted = violators.sort()
    expect(
      sorted,
      `Unexpected raw SQL usage found in: ${sorted.join(', ')}. Either avoid $queryRaw/$executeRaw or add the file to ALLOWED_RAW_SQL_FILES with a justification comment.`,
    ).toEqual([])
  })

  it('allowlist entries actually exist in src/', () => {
    // Prevents stale entries in ALLOWED_RAW_SQL_FILES going unnoticed.
    for (const rel of ALLOWED_RAW_SQL_FILES) {
      const absPath = join(srcDir, ...rel.split('/'))
      expect(
        existsSync(absPath),
        `ALLOWED_RAW_SQL_FILES contains '${rel}' but the file does not exist`,
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Guard 2: Base Prisma client (unscoped) handler imports
// ---------------------------------------------------------------------------

/**
 * ALLOWED_BASE_CLIENT_HANDLERS — handlers (relative to apps/api/src/handlers/)
 * that are known to import the unscoped base Prisma client via
 *   import { db } from '../db'   (or '../../db', '../../db', etc.)
 *
 * This is the legitimate cross-tenant surface:
 *   - admin/** handlers operate across tenants and cannot use the tenant-scoped
 *     client.
 *   - auth.ts resolves the session before a tenant is known.
 *   - longhaul-cloud/** reach tenant MSSQL via the mssql-executor Lambda; they
 *     still use the base client for Neon lookups (connection strings, reference
 *     data) that span all tenants.
 *   - settings.ts, vpn-agent.ts, dashboard-pegii.ts: cross-tenant or
 *     platform-level lookups.
 *   - integrations/ringcentral-{oauth,webhook}.ts: webhook path pre-dates
 *     per-request tenant resolution.
 *   - workflow-internal.ts: invoked by the workflow engine, tenant resolved
 *     from payload.
 *
 * Lambda cron handlers (lambda-*.ts), lib/, and middleware/ are intentionally
 * NOT covered here — they are either already excluded from the scan scope
 * (lib/), or they legitimately need the base client for cross-tenant work and
 * are reviewed separately.
 *
 * To add a new handler: add the path here AND include a justification comment
 * explaining why `c.get('db')` (the tenant-scoped client) cannot be used.
 */
const ALLOWED_BASE_CLIENT_HANDLERS: ReadonlySet<string> = new Set([
  'admin/tenants.ts',
  'admin/tenant-users.ts',
  'admin/vpn-diagnose.ts',
  'admin/vpn.ts',
  'admin/workflows.ts',
  // admin/tariffs.ts manages platform-global 400NG tariff data (no tenantId);
  // there is no tenant scope to apply, so it uses the base client like the
  // other admin/** cross-tenant handlers.
  'admin/tariffs.ts',
  'auth.ts',
  'dashboard-pegii.ts',
  // Integration-validator config: both read the base client only for the
  // cross-tenant registry overlay (GLOBAL configs span tenants) — tenant data
  // still flows through c.get('db'). See integration-validation/registry.ts.
  'integration-validation/config.ts',
  'integration-validation/validate.ts',
  'integrations/ringcentral-oauth.ts',
  'integrations/ringcentral-webhook.ts',
  // Ingress endpoint (sdk-feedback 0021): pre-tenant, like the RingCentral
  // webhook — it resolves the tenant FROM the presented token, so it must query
  // the base client cross-tenant (credential prefix lookup) before any tenant is
  // known. Tenant isolation is enforced by the token→tenant resolution itself.
  'ingress.ts',
  'longhaul-cloud/activity-types.ts',
  'longhaul-cloud/dispatchers.ts',
  'longhaul-cloud/driver-planning.ts',
  'longhaul-cloud/drivers.ts',
  'longhaul-cloud/filter-options.ts',
  'longhaul-cloud/planners.ts',
  'longhaul-cloud/reference-data.ts',
  'longhaul-cloud/rejected-trips.ts',
  'longhaul-cloud/shipment-filters-default.ts',
  'longhaul-cloud/shipment-filters.ts',
  'longhaul-cloud/shipments-list.ts',
  'longhaul-cloud/states.ts',
  'longhaul-cloud/trip-detail.ts',
  'longhaul-cloud/trips-list.ts',
  'longhaul-cloud/trip-statuses.ts',
  'longhaul-cloud/users-me.ts',
  'longhaul-cloud/version.ts',
  'longhaul-cloud/zones.ts',
  'settings.ts',
  // pegII config lives on the Tenant row (customerSource / pegiiApiBaseUrl /
  // pegiiApiKeyRef) — read/written via the base client exactly like settings.ts,
  // since Tenant is not a tenant-scoped model. No tenant data flows here.
  'settings-pegii.ts',
  'vpn-agent.ts',
  'workflow-internal.ts',
])

// Matches relative imports of the root Prisma base client — patterns like:
//   import { db } from '../db'         (handlers at the top level)
//   import { db as basePrisma } from '../../db'  (handlers in subdirectories)
// Requires at least one ../ traversal so that same-directory sibling modules
// named 'db' (e.g. handlers/billing/db.ts) are not matched.
const BASE_CLIENT_IMPORT_REGEX = /from\s+['"](\.\.\/)+db['"]/

describe('Guard 2: Base Prisma client (unscoped) handler imports', () => {
  it('only allowlisted handlers import the unscoped base Prisma client', () => {
    // Scan all .ts files directly under handlers/ (and subdirectories),
    // excluding *.test.ts and __tests__/.
    const handlerFiles = collectTsFiles(handlersDir)
    const violators: string[] = []

    for (const absPath of handlerFiles) {
      const content = readFileSync(absPath, 'utf-8')
      if (BASE_CLIENT_IMPORT_REGEX.test(content)) {
        // Normalise to handlers-relative path with forward slashes.
        const rel = relative(handlersDir, absPath).split(sep).join('/')
        if (!ALLOWED_BASE_CLIENT_HANDLERS.has(rel)) {
          violators.push(rel)
        }
      }
    }

    const sorted = violators.sort()
    expect(
      sorted,
      'New handler imports the unscoped base Prisma client. ' +
        "Either use `c.get('db')` (tenant-scoped) or add the file to " +
        'ALLOWED_BASE_CLIENT_HANDLERS with a justification comment. ' +
        `Offending files: ${sorted.join(', ')}`,
    ).toEqual([])
  })

  it('allowlist entries actually exist as handler files', () => {
    // Prevents stale entries in ALLOWED_BASE_CLIENT_HANDLERS going unnoticed.
    for (const rel of ALLOWED_BASE_CLIENT_HANDLERS) {
      const absPath = join(handlersDir, ...rel.split('/'))
      expect(
        existsSync(absPath),
        `ALLOWED_BASE_CLIENT_HANDLERS contains '${rel}' but the file does not exist in handlers/`,
      ).toBe(true)
    }
  })
})
