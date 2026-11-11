import { describe, it, expect, beforeAll } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { ApiStack } from '../api-stack'

// ---------------------------------------------------------------------------
// Bundle contract — regression test for the "Lambda asset missing non-JS
// files" class of bug.
//
// History: between 2026-04-30 and 2026-05-06 two separate provisioning
// regressions reached staging because esbuild silently dropped non-JS files
// from the API Lambda asset:
//   - 19c0798: cedar-wasm's cedar_wasm_bg.wasm not included.
//   - 5588b18: cedar.schema.json + policies/**/*.cedar not included.
//
// Both manifested as ENOENT at runtime — `cedar-wasm` crashes the Lambda
// during init, the policy loader crashes during AVP provisioning. esbuild
// only follows JS imports, so anything read via readFileSync(__dirname/...)
// is invisible to it. The fix in both cases was bundling configuration in
// `api-stack.ts` (nodeModules for the wasm package, commandHooks.afterBundling
// for the Cedar files); this test pins both so a future config change can't
// silently drop them again.
//
// What this catches:
//   - The afterBundling hook getting deleted, renamed, or pointed at the
//     wrong source path.
//   - The nodeModules entry for cedar-wasm being moved to externalModules
//     (which would re-introduce the wasm-missing bug).
//   - A new file the API reads via readFileSync that nobody added to the
//     bundling config.
//
// What this misses:
//   - A change in load.ts that reads from a different runtime path than
//     where the bundling hook copies the files (would manifest at runtime,
//     not at synth time). Live integration test would catch this — see
//     plans/todo/avp-provisioning-regression-tests.md item #3.
//
// Cost: real bundling adds ~8s locally and ~59s on a loaded 2-core CI runner
// (hence the beforeAll's 300s budget). PEGASUS_SKIP_BUNDLE_TESTS=1 is the only
// supported way to opt out.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '../../../../..')
const AUTHZ_SRC = path.join(REPO_ROOT, 'apps/api/src/authz')

// Source paths the bundling config copies into the asset. Pinned in this
// test as the contract — if either of these moves, the test breaks AND the
// bundling config in `api-stack.ts` needs the matching update.

// The ONLY intentional way to not run this suite. Local watch-mode can opt out;
// nothing else may, because this is the only guard that catches an unresolvable
// import reaching the deployed API bundle (see #665: our own protobufjs override
// capped @temporalio below the major it needed and esbuild could not resolve
// `protobufjs/ext/protojson` — a bundle that synth and deploy carry to
// production happily and that surfaces only as a Lambda INIT crash, the #594
// failure mode).
const explicitSkip = process.env['PEGASUS_SKIP_BUNDLE_TESTS'] === '1'

// esbuild's bundling step resolves `import { ... } from '@pegasus/domain'`
// references in the API source against the package's `main: dist/index.js`. On a
// fresh clone where the workspace deps haven't been built, that file is missing
// and esbuild fails with a not-actionable "Could not resolve '@pegasus/domain'".
//
// This used to `describe.skipIf` on that condition. It no longer does, and the
// distinction matters: a guard that skips itself when its precondition is absent
// reports green in exactly the situation it is least sure about, and a skip is
// something nobody investigates. It now throws. `turbo run test` satisfies the
// precondition via `test.dependsOn: ['@pegasus/domain#build']` in
// `packages/infra/turbo.json`, so the throw only fires when this package's
// vitest is invoked directly without that build — and then it tells you so
// instead of quietly proving nothing.
if (!explicitSkip && !fs.existsSync(path.join(REPO_ROOT, 'packages/domain/dist/index.js'))) {
  throw new Error(
    'packages/domain/dist/index.js is missing, so the API bundle cannot be built and ' +
      'this guard cannot run.\n' +
      'Fix: npx turbo run build --filter=@pegasus/domain   (or run the suite via `turbo run test`, ' +
      'which builds it first)\n' +
      'To deliberately opt out in watch mode: PEGASUS_SKIP_BUNDLE_TESTS=1',
  )
}

// Two functions ship this bundle configuration: ApiFunction (lambda.ts) and its
// streaming twin AssistantFunction (lambda-assistant.ts). Both read the Cedar
// files and the wasm at runtime, so the contract is asserted on each. The
// assistant asset is told apart by its path-guard literal, which only
// lambda-assistant.ts contains.
const ASSISTANT_MARKER = '/api/v1/assistant'

describe.skipIf(explicitSkip)(`ApiStack — bundled asset contract`, () => {
  const assets: Record<'api' | 'assistant', string> = { api: '', assistant: '' }

  beforeAll(() => {
    // Synth into an isolated tmpdir so this test doesn't trample the
    // shared `cdk.out/` used by other test runs and `npm run synth`.
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pegasus-bundle-test-'))
    const app = new cdk.App({ outdir })
    new ApiStack(app, 'BundleTestApi', {
      env: { account: '111111111111', region: 'us-east-1' },
    })
    app.synth()

    // The function assets are the directories with `index.js` AND a
    // `node_modules/@cedar-policy/cedar-wasm` subtree. (Other asset
    // directories belong to other constructs — e.g. CDK bootstrap assets —
    // and don't have those markers.)
    const candidates = fs
      .readdirSync(outdir)
      .filter((name) => name.startsWith('asset.'))
      .map((name) => path.join(outdir, name))
      .filter((dir) => {
        const stat = fs.statSync(dir)
        if (!stat.isDirectory()) return false
        return (
          fs.existsSync(path.join(dir, 'index.js')) &&
          fs.existsSync(path.join(dir, 'node_modules/@cedar-policy/cedar-wasm'))
        )
      })

    if (candidates.length !== 2) {
      throw new Error(
        `Expected exactly two cedar-wasm function assets (api + assistant) in ${outdir}, found ${candidates.length}: ${candidates.join(', ')}. ` +
          `If a new bundled Lambda was added that also depends on cedar-wasm, this test's heuristic needs updating.`,
      )
    }
    for (const dir of candidates) {
      const isAssistant = fs
        .readFileSync(path.join(dir, 'index.js'), 'utf8')
        .includes(ASSISTANT_MARKER)
      assets[isAssistant ? 'assistant' : 'api'] = dir
    }
    if (!assets.api || !assets.assistant) {
      throw new Error(`Could not tell the api and assistant assets apart: ${candidates.join(', ')}`)
    }
  }, 300_000) // A real esbuild bundle of the whole API (twice). ~8s locally on
  // 12 cores, but this runs inside `turbo test`'s 15-task fan-out on a 2-core
  // CI runner, and aws-cdk-lib 2.267 synthesizes ~2.5x slower than 2.261 — the
  // old 60s budget timed out there. The assertions below are about bundle
  // *contents*, never speed, so the budget is deliberately far above the
  // observed cost.

  describe.each(['api', 'assistant'] as const)('%s function asset', (which) => {
    it('includes the bundled index.js and source map', () => {
      const assetDir = assets[which]
      expect(fs.existsSync(path.join(assetDir, 'index.js'))).toBe(true)
      expect(fs.existsSync(path.join(assetDir, 'index.js.map'))).toBe(true)
    })

    it('includes the cedar-wasm package as a real node_modules dependency (not bundled)', () => {
      // Regression for 19c0798 — cedar-wasm reads its .wasm asset via
      // readFileSync(__dirname + 'cedar_wasm_bg.wasm') at module init, which
      // requires the .wasm to live next to the package's JS file inside the
      // asset's node_modules tree.
      expect(
        fs.existsSync(
          path.join(
            assets[which],
            'node_modules/@cedar-policy/cedar-wasm/nodejs/cedar_wasm_bg.wasm',
          ),
        ),
      ).toBe(true)
    })

    it('includes cedar.schema.json at the asset root', () => {
      // Regression for 5588b18 — apps/api/src/authz/load.ts loads this via
      // readFileSync(__dirname + '/cedar.schema.json'), which after bundling
      // means the asset root.
      const bundled = path.join(assets[which], 'cedar.schema.json')
      expect(fs.existsSync(bundled)).toBe(true)

      // Sanity-check: bundled content matches source so we don't ship a
      // stale or empty schema.
      const source = fs.readFileSync(path.join(AUTHZ_SRC, 'cedar.schema.json'), 'utf8')
      expect(fs.readFileSync(bundled, 'utf8')).toBe(source)
    })

    it('includes every .cedar policy file under policies/, preserving the directory structure', () => {
      // Walk the source tree, then assert every .cedar file is present at the
      // matching path inside the asset's policies/. Catches both "policy file
      // forgotten" and "policy subdirectory like 30-personas/ flattened."
      const sourcePolicies: string[] = []
      function walk(dir: string, prefix = ''): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), rel)
          } else if (entry.isFile() && entry.name.endsWith('.cedar')) {
            sourcePolicies.push(rel)
          }
        }
      }
      walk(path.join(AUTHZ_SRC, 'policies'))
      expect(sourcePolicies.length).toBeGreaterThan(0)

      const missing = sourcePolicies.filter(
        (rel) => !fs.existsSync(path.join(assets[which], 'policies', rel)),
      )
      expect(missing).toEqual([])
    })
  })

  it('bundles the Bedrock SDK into the assistant asset (CJS, no INIT-time ESM import)', () => {
    // The plan's §4 bundling check: the assistant's inference client must be
    // bundled like any other dependency, not left as an external require.
    const bundle = fs.readFileSync(path.join(assets.assistant, 'index.js'), 'utf8')
    expect(bundle).toContain('invoke-with-response-stream')
    expect(bundle).not.toMatch(/require\(["']@anthropic-ai\//)
  })
})
