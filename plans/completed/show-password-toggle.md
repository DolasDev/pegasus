# Show-password toggle on the login screens

## Goal

Every password field on the two login screens gets a small eye / eye-off toggle
that reveals the typed password. Defaults to hidden; the icon sits inside the
field on the right.

## Why

Typing a password blind into a login form is the single most error-prone moment
in the product, and both login screens are also where users set a _new_ password
(Cognito `NEW_PASSWORD_REQUIRED` and the self-service reset flow) — a
confirm-password pair with no reveal makes a typo cost a full round trip.

## Scope

### tenant-web — `apps/tenant-web/src/routes/login.tsx` (5 fields)

- sign-in password (`#password`, `autoComplete="current-password"`)
- new-password step: new + confirm
- reset step: new + confirm

The app already depends on `lucide-react` (`^0.577.0`) and has a shadcn-style
`Input` at `src/components/ui/input.tsx`.

**Add `apps/tenant-web/src/components/ui/password-input.tsx`** — wraps `Input`,
owns the `visible` state, renders a `<button type="button">` with lucide
`Eye`/`EyeOff`. Forwards ref and all other input props through, so the call sites
keep `id`, `value`, `onChange`, `required`, `autoComplete`, `autoFocus`.

Replace all 5 `<Input type="password" …>` with `<PasswordInput …>`.

### admin-web — `apps/admin-web/src/routes/login.tsx` (3 fields)

- sign-in password
- reset: `#reset-new-password`, `#reset-confirm-password`

admin-web has **no** icon library and uses raw `<input>` + Tailwind classes
(no `components/ui/` directory). Do **not** add `lucide-react` for three icons —
per CLAUDE.md's dependency guidance, prefer the simpler alternative.

**Add `apps/admin-web/src/components/PasswordInput.tsx`** — same behavior with a
hand-rolled inline `<svg>` eye / eye-off (two small path sets, `currentColor`,
`aria-hidden`), reusing the existing input class string so it looks identical to
its neighbors.

## Behavior contract (both apps)

- Toggling flips `type` between `password` and `text`. Never changes `value`.
- Toggle is `type="button"` — must not submit the form.
- `aria-label` = "Show password" / "Hide password"; `aria-pressed` reflects state.
- Input gets right padding (`pr-10`) so text never runs under the icon.
- Icon is `tabindex`-reachable and hit-target sized (min 36px), muted color,
  foreground on hover.
- Each field owns its own visibility state — revealing "new password" must not
  reveal "confirm password".
- Default state is hidden on mount, and after a step change the field remounts
  hidden.

## Tests

- `apps/tenant-web/src/routes/login.test.tsx` (exists): sign-in field starts
  `type="password"`, clicking the toggle flips to `text` and the label flips to
  "Hide password", clicking again flips back; the click does not submit the form.
- `apps/admin-web/src/__tests__/` (tests live here): a `PasswordInput.test.tsx`
  covering the same contract plus independent state across two instances.

## Out of scope

- The other `type="password"` fields elsewhere in tenant-web
  (`settings.workflows.tsx`, `settings.integrations.ringcentral.tsx`,
  `sso-config.tsx`) — those are secret-entry fields, not login. Can follow later
  now that the component exists.
- No change to auth logic, Cognito calls, or the SSO/step state machine.

## Verification

- `npm run typecheck`, `npm test`, `npm run lint` green.
- Manual: reveal works on each of the 8 fields; Enter still submits.
