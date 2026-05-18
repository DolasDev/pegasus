# Pre-push hook + mobile tests broken on Windows

**Discovered:** 2026-05-14 while pushing the longhaul on-prem fix from the
Windows Dolios box (`DOLAB-M70Q-1`). Bypassed with `--no-verify` once with
user approval; needs fixing so future Windows-host pushes don't have to
bypass.

## Two independent problems

### (a) `.husky/pre-push` uses `node node_modules/.bin/turbo`

```sh
exec node node_modules/.bin/turbo run typecheck test
```

On Linux/macOS this works (sh-shebang dispatches). On Windows in any shell
where `node_modules/.bin/turbo` resolves to the bash shim (Git Bash, MSYS,
WSL-mounted-but-using-Windows-node), `node` tries to parse the shell script
as JS and fails:

```
C:\apps\pegasus\node_modules\.bin\turbo:2
basedir=$(dirname "$(echo "$0" | sed -e 's,\\,/,g')")
          ^^^^^^^
SyntaxError: missing ) after argument list
```

**Fix candidates:**

- Drop the `node` prefix entirely: `exec node_modules/.bin/turbo run typecheck test`.
  Lets the OS pick the right wrapper (`.cmd` on Windows, sh on Linux).
- Or use `npx turbo run typecheck test`.
- Or check OS and pick the right entry.

The CI workflow uses the same `node node_modules/.bin/turbo` pattern
(`.github/workflows/ci.yml`) but runs on `ubuntu-latest`, where it works.
Worth fixing both in the same change so they don't drift.

### (b) `apps/mobile` tests fail with `Flow is not supported`

Even if (a) is fixed, `turbo run test` still fails because vitest's
rolldown parser can't handle the Flow type syntax in
`node_modules/react-native/index.js`:

```
RolldownError: Parse failure: Flow is not supported
File: /@fs/C:/apps/pegasus/node_modules/react-native/index.js:1:0
```

Two failing files: `__tests__/app/(auth)/login.test.tsx`,
`__tests__/app/(auth)/tenant-picker.test.tsx`. Both ARE-IMPORT-DEPENDENT
on react-native via the auth/tenant routing. Confirmed pre-existing on
`HEAD~2` (not caused by the longhaul fix).

Why CI passes: the Linux runner uses a different transform pipeline or
the rolldown/vite versions resolve differently when the OS is Linux. Worth
verifying which combination CI actually exercises by checking a recent
green CI artefact.

**Fix candidates:**

- Add `@babel/plugin-transform-flow-strip-types` to the mobile vitest
  transform pipeline, OR
- Pin `vitest` (and/or `rolldown`) to versions that have Flow support, OR
- Switch the mobile vitest config to a different parser (esbuild) that
  handles Flow, OR
- Skip those 2 test files on Windows.

The plan's "Things to NOT do" section captures the broader spirit
("Don't bypass pre-push hooks with --no-verify to escape unrelated test
failures"). This entry is a one-time exception with explicit user
approval — repeat bypasses should be replaced by fixing the hook.

## Acceptance

Pre-push hook runs clean on a Windows host (Git Bash + nvm4w) without
`--no-verify`, AND `node_modules/.bin/turbo run test` passes locally
(including mobile).
