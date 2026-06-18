/**
 * Drift guard: verifies that .github/deploy-manifest.json stays in sync with
 * the stacks that `cdk ls` produces for each env. Adding a stack to bin/app.ts
 * without updating the manifest will fail CI with an exact set diff.
 *
 * Runs in the infra vitest suite (lib/**\/__tests__\/**\/*.test.ts).
 * `cdk ls` is called 3× (dev / staging / prod) via execSync.
 */

import { execSync } from 'node:child_process'
import { describe, test, expect } from 'vitest'
import manifest from '../../../../../.github/deploy-manifest.json'

type EnvName = 'dev' | 'staging' | 'prod'

/**
 * Call `cdk ls` for the given env and return the sorted list of stack-suffix
 * names (the part after `PegasusXxx-`).
 *
 * `cdk ls` output lines look like:
 *   PegasusStaging-ApiStack (pegasus-staging-api)
 *
 * We take the construct-ID token (before the first space), then strip the
 * env-prefix word and leading dash to get just the stack suffix, e.g. "ApiStack".
 */
function cdkLsStacks(env: EnvName): string[] {
  const raw = execSync(`npx cdk ls -c env=${env} --app "npx tsx bin/app.ts"`, {
    cwd: `${__dirname}/../..`,
    encoding: 'utf8',
  })
  return raw
    .trim()
    .split('\n')
    .map((line) => {
      // Strip optional " (cfn-stack-name)" suffix so only the construct ID remains.
      const constructId = line.split(' ')[0] ?? line
      // constructId is like "PegasusDev-ApiStack"; drop everything up to and
      // including the first dash to get "ApiStack".
      const dashIdx = constructId.indexOf('-')
      return dashIdx === -1 ? constructId : constructId.slice(dashIdx + 1)
    })
    .sort()
}

/**
 * Derive the expected stack-suffix list from the manifest for a given env.
 * Applies envConditionalStacks (stacks that only exist in certain envs) and
 * envExtraStacks (per-env additions not tied to a component).
 */
function expectedStacks(env: EnvName): string[] {
  const conditionalMap = manifest.envConditionalStacks as Record<string, string[]>
  const allowed = (s: string): boolean => {
    const envList = conditionalMap[s]
    return envList == null || envList.includes(env)
  }

  const allStacks = [
    ...Object.values(manifest.components).flatMap((c) => c.stacks),
    ...(manifest.envExtraStacks[env as keyof typeof manifest.envExtraStacks] ?? []),
  ]
    .filter(allowed)
    // Deduplicate (envExtraStacks entries may overlap with component stacks).
    .filter((s, i, a) => a.indexOf(s) === i)

  return allStacks.sort()
}

describe('deploy-manifest.json drift guard', () => {
  test.each(['dev', 'staging', 'prod'] as const)(
    'manifest matches cdk ls for %s',
    (env) => {
      const actual = cdkLsStacks(env)
      const expected = expectedStacks(env)
      expect(actual).toEqual(expected)
    },
    // cdk ls synthesises the full app — give it generous time per env.
    120_000,
  )
})
