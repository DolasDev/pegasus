import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// `bundling.nodeModules` entries must be resolvable at the ROOT of the lockfile.
//
// History (#762, 2026-10-04): staging Deploy failed with
//
//   npm error `npm ci` can only install packages when your package.json and
//   package-lock.json … are in sync.
//   npm error Missing: sharp@0.35.5 from lock file
//   [«FailedToBundleAsset» … PegasusStaging-DocumentsStack/ConverterFunction …]
//
// `NodejsFunction` implements `bundling.nodeModules` by writing a temp
// package.json listing those packages, copying the project's package-lock.json
// beside it, and running `npm ci` in that directory. `npm ci` only resolves a
// package the lockfile holds at the **root** — a `apps/<x>/node_modules/<pkg>`
// entry is invisible to it.
//
// sharp satisfied that by luck for months: apps/api and apps/mobile declared
// compatible ranges and npm hoisted one copy to the root. A dependency bump
// moved both to ^0.35.5, root `@emnapi/runtime@1.11.0` could not satisfy sharp
// 0.35.5's 1.11.3, so npm nested a copy under each workspace and left NO root
// entry. Nothing about that is visible to typecheck, lint, or any test —
// bundling runs only at deploy time — so CI was fully green and `main`'s Deploy
// broke. The remedy was a root `devDependencies` edge on sharp (see the
// `//devDependencies` note in the root package.json), the same shape as the
// `tsx` edge and the `prisma` pin before it.
//
// This test is the PR-time gate that was missing. It is deliberately static —
// no synth, no bundling, no network — so it costs milliseconds and runs
// everywhere, which is what makes it suitable as the thing standing between a
// Dependabot lockfile and a broken release path.
//
// What it catches: any `nodeModules` package that is not root-resolvable in the
// lockfile, whether because a bump denested it or because someone added a new
// entry for a package only a workspace declares.
//
// What it misses: a package present at the root but at a version the temp
// package.json won't accept, and anything about the asset's CONTENTS (that is
// `api-stack.bundle.test.ts`'s job, which does real bundling).
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '../../../../..')
const INFRA_LIB = path.join(__dirname, '../..')

/** Every `nodeModules: [...]` list declared anywhere under packages/infra/lib. */
function collectNodeModuleDeclarations(): { file: string; packages: string[] }[] {
  const out: { file: string; packages: string[] }[] = []

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // __tests__ mentions `nodeModules` in prose; only real stack code counts.
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue

      const src = fs.readFileSync(full, 'utf-8')
      // `nodeModules: ['a', 'b']`, including across line breaks.
      for (const match of src.matchAll(/nodeModules\s*:\s*\[([^\]]*)\]/g)) {
        const packages = [...(match[1] ?? '').matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!)
        if (packages.length > 0) {
          out.push({ file: path.relative(REPO_ROOT, full), packages })
        }
      }
    }
  }

  walk(INFRA_LIB)
  return out
}

describe('CDK bundling.nodeModules — root-resolvable in the lockfile', () => {
  const declarations = collectNodeModuleDeclarations()
  const lockPath = path.join(REPO_ROOT, 'package-lock.json')

  // A scanner that silently stops matching would make this suite pass by finding
  // nothing to check — the worst failure mode a guard can have. These two assert
  // the scanner still sees the call sites we know exist, so the regex breaking is
  // a RED test rather than a green one.
  it('finds the nodeModules call sites it is meant to police', () => {
    expect(declarations.length).toBeGreaterThanOrEqual(3)

    const files = declarations.map((d) => d.file)
    expect(files).toContain('packages/infra/lib/stacks/documents-stack.ts')
    expect(files).toContain('packages/infra/lib/stacks/api-stack.ts')
  })

  it('still sees the packages that caused #762 and #665', () => {
    const all = declarations.flatMap((d) => d.packages)
    expect(all).toContain('sharp')
    expect(all).toContain('@cedar-policy/cedar-wasm')
  })

  it('every declared package has a ROOT entry in package-lock.json', () => {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as {
      packages: Record<string, { version?: string }>
    }

    const offenders: string[] = []
    for (const { file, packages } of declarations) {
      for (const pkg of packages) {
        if (lock.packages[`node_modules/${pkg}`] === undefined) {
          const nested = Object.keys(lock.packages).filter((k) => k.endsWith(`/${pkg}`))
          offenders.push(
            `${pkg} (listed in ${file}) has no root \`node_modules/${pkg}\` entry; ` +
              `found instead: ${nested.length > 0 ? nested.join(', ') : 'nowhere'}`,
          )
        }
      }
    }

    expect(
      offenders,
      'A `bundling.nodeModules` package is not root-resolvable, so `NodejsFunction`\n' +
        'bundling will fail at DEPLOY time with "Missing: <pkg> from lock file" —\n' +
        'after this PR merges and with every other check green. See #762.\n\n' +
        offenders.join('\n') +
        '\n\nFix: declare the package in the ROOT package.json `devDependencies` at the\n' +
        'same range the workspace uses, then `npm install --package-lock-only`. Record\n' +
        'why in the root `//devDependencies` note so nobody prunes it as unused.\n' +
        'A plain lockfile regeneration does NOT re-hoist it.',
    ).toEqual([])
  })
})
