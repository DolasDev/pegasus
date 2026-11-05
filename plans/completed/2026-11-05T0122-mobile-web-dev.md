# Mobile app: make Expo web dev work against the deployed API

Branch: `fix/mobile-web-dev` (worktree `../pegasus-mobile-web-dev`). All changes stay on this branch.

## Goal

`apps/mobile` should run in a browser (Expo web, opened from any tailnet device)
against the deployed API with no hand-rolled env overrides or side processes.
Today three things block it (found 2026-11-04 while testing by hand):

1. **Web crash** `Cannot read properties of undefined (reading 'getEnforcing')` —
   `react-native-document-scanner-plugin` is native-only and is imported at module
   scope by `src/services/documentCapture.ts`. `metro.config.js` already aliases a
   web stub, but only when `PEGASUS_STORE_CAPTURE=1` (store screenshots).
2. **Stale local `.env`** — developer `.env` files drift (one still pointed at the
   pre-split account's API, which 500s on `resolve-tenants`). Release builds
   regenerate it from SSM inside `.github/actions/mobile-eas-config`, but there is
   no way to do the same locally.
3. **CORS** — the deployed API only allows its own web origins, so a browser on the
   Expo origin is blocked. Phones don't enforce CORS, so native is unaffected.

## Approach

- **Stub always on web.** Gate the alias on `platform === 'web'` only; drop
  `PEGASUS_STORE_CAPTURE` (no other readers). Move the stub out of `store-assets/`
  since it is no longer capture-only. Unit-test the resolver (web → stub,
  ios/android → real module).
- **`scripts/env-from-ssm.sh`** — the four SSM reads → `.env`, byte-identical to the
  action's heredoc. Output path resolves relative to the script, optional path arg.
  `::add-mask::` only under `GITHUB_ACTIONS`. The action calls the script instead of
  its inline copy (single source of truth). `npm run env:prod` wraps it with the
  `dolas-pegasus-prod-ro` profile.
- **Same-origin API forwarding in Metro.** `config.server.enhanceMiddleware` forwards
  `/api/*` to the upstream in `EXPO_PUBLIC_API_URL`, so `npm run dev:web` points the
  app at Metro's own origin — no CORS, no second process. Opt-in via
  `PEGASUS_API_PROXY_TARGET`, so `dev`, device and store builds are unchanged.
  Fallback if Expo 55 ignores `enhanceMiddleware`: a standalone proxy process.
- Docs: mobile README section, GOTCHAS entry.

## Verification

- Resolver unit test; `typecheck`, `lint`, `test` in `apps/mobile`.
- `env-from-ssm.sh` output (scratch path) diffed against the action heredoc's output
  for the same values — the action can't be run from a branch, so this diff is the
  parity test.
- Run `dev:web` for real; headless browser enters an email → lookup reaches the API
  through Metro and the app shows the API's answer (not a CORS/network error).

## Out of scope

Hiding the Scan button on web; changing prod CORS; SSO on web (`movingapp://`
redirect can't complete in a browser).
