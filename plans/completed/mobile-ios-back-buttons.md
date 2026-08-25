# iOS driver app — restore back buttons on pushed screens

## Context

Drivers on iOS have no way back out of three places in the app. Android hides the
problem because it has hardware/gesture back, which is why this surfaces as an
iOS-only complaint.

**Root cause (confirmed at source level).** `app/trip/[id].tsx` and
`app/shipment/[orderNum].tsx` each live in their **own single-screen nested
`Stack`** (`app/trip/_layout.tsx`, `app/shipment/_layout.tsx`), mounted under the
root stack in `app/_layout.tsx` as the group screens `trip` and `shipment`. On
iOS the back chevron is UIKit's, not React Navigation's — `react-native-screens`
only ever _hides_ it (`navitem.hidesBackButton = config.hideBackButton`,
`ios/RNSScreenStackHeaderConfig.mm:628`), and UIKit renders it only when the view
controller is not first in its `UINavigationController`. Each inner stack holds
exactly one screen, so the chevron never renders and the `headerBackTitle: 'Back'`
already configured in both layouts is dead config today.

**Two further gaps:**

- **Settings** (`app/(drawer)/settings.tsx`) is a drawer screen hidden from the
  drawer list (`drawerItemStyle: { display: 'none' }`) and reached only by
  `router.push('/settings')` from the avatar menu (`src/components/UserMenuButton.tsx:33`).
  `app/(drawer)/_layout.tsx:23` hard-codes the ☰ hamburger as `headerLeft` for
  _every_ drawer screen, so Settings shows a hamburger where a back button belongs.
- **Login** (`app/(auth)/login.tsx`) advances `email → password | providers` through
  internal `setStep` state with `headerShown: false`, and `tenant-picker` arrives via
  `router.replace`. A driver who mistypes their email has to force-quit the app.

**Outcome:** every pushed screen gets a working back affordance, using the native
iOS chevron wherever a real navigation stack exists.

## Approach

### 1. Flatten Trip and Shipment onto the root stack

Make the two detail screens genuine index-1 entries of the _same_ native stack as
`(drawer)`, so UIKit renders the chevron, the "Back" label, and the edge-swipe
gesture with no custom code and no icon dependency.

- **Delete** `apps/mobile/app/trip/_layout.tsx` and
  `apps/mobile/app/shipment/_layout.tsx`. Both are identical four-line header-style
  wrappers; their content moves into the root stack.
- **`apps/mobile/app/_layout.tsx`** — add a module-scope `detailHeader` const
  carrying the options lifted verbatim from the deleted layouts
  (`headerStyle: { backgroundColor: colors.backgroundDark }`, `headerTintColor:
colors.textLight`, `headerTitleStyle: { fontWeight: '700', fontSize: fontSize.large }`,
  `headerBackTitle: 'Back'`) plus `headerShown: true` to override the root
  `screenOptions={{ headerShown: false }}`. Type it `as const` or annotate it —
  a bare `'700'` widens to `string` and won't satisfy `TextStyle['fontWeight']`.
- Replace the group screens with the flattened routes inside `Stack.Protected`:

  ```tsx
  <Stack.Screen name="(drawer)" />
  <Stack.Screen name="trip/[id]" options={{ ...detailHeader, title: 'Trip' }} />
  <Stack.Screen name="shipment/[orderNum]" options={{ ...detailHeader, title: 'Shipment' }} />
  ```

- The screens' own dynamic `<Stack.Screen options={{ title: … }} />` calls
  (`app/trip/[id].tsx:49,58,70`, `app/shipment/[orderNum].tsx:69,78,126`) keep working
  unchanged — they now target the root navigator instead of the inner one.
- No route paths change: `router.push('/trip/${id}')` (`app/(drawer)/trips.tsx:133`),
  `router.push('/shipment/…')` (`app/trip/[id].tsx:107`) and the push-notification
  deep link (`app/_layout.tsx:34` → `src/services/pushNotifications.ts` `trip.assigned`)
  all still resolve.

### 2. Move Settings out of the drawer onto the root stack

Settings already _behaves_ like a pushed detail screen — hidden from the drawer,
entered by push. Making that structural gets it the same native back button.

- `git mv apps/mobile/app/\(drawer\)/settings.tsx apps/mobile/app/settings.tsx`, then
  fix its relative imports one level up (`../../src/…` → `../src/…`).
- Declare it on the root stack next to the other two, **inside the
  `<Stack.Protected guard={isAuthenticated}>` block**:
  `<Stack.Screen name="settings" options={{ ...detailHeader, title: 'Settings' }} />`.
  This is load-bearing: Settings is auth-guarded today only transitively, by living
  inside the `(drawer)` group. Expo Router auto-registers any filesystem route that
  isn't explicitly declared, so a `settings` screen left outside the Protected block
  — or omitted — becomes reachable unauthenticated. All three flattened screens
  (`trip/[id]`, `shipment/[orderNum]`, `settings`) must sit inside that block.
- Remove the `<Drawer.Screen name="settings" …>` entry from `app/(drawer)/_layout.tsx`.
- `UserMenuButton` needs no change — `/settings` still resolves.
- Verified safe: `settings.tsx` uses neither `TripsContext` (which `(drawer)/_layout.tsx`
  provides) nor `GestureHandlerRootView`, so leaving the drawer subtree costs it nothing.
  It also drops the drawer's `headerRight` avatar menu, which is correct — you're
  already in Settings.

### 3. In-content back on the login sub-steps

The login stack has `headerShown: false` and the steps are React state, not routes,
so this one back control must be in-content. Follow the existing Unicode-glyph
convention (☰ hamburger, › row chevrons) rather than adding an icon package.

- **`apps/mobile/app/(auth)/login.tsx`** — add a `resetToEmailStep()` helper that
  does `setStep('email')` and clears `password` / `passwordError`, and render a
  plain text control (`‹ Use a different email`) near the top of the form in both
  the `providers` branch (~line 184) and the `password` branch (~line 244).
- Give it `accessibilityRole="button"` and `accessibilityLabel="Use a different email"`,
  matching the `Pressable` precedent in `src/components/UserMenuButton.tsx` and the
  hamburger at `app/(drawer)/_layout.tsx:23-32`.
- Style it off the existing link-ish `styles.toggleText`; no new color tokens.
- **Check while implementing:** login can be entered directly in the `password` step
  via `tenant-picker`'s `router.replace({ pathname: '/(auth)/login', params: { step … } })`
  (`app/(auth)/tenant-picker.tsx:44`). Confirm the `email` state is initialized from
  those handoff params, not just `step` — otherwise "Use a different email" lands the
  driver on a blank email form. Acceptable either way, but decide it deliberately.

## Files

| File                                                                     | Change                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `apps/mobile/app/_layout.tsx`                                            | Add `detailHeader`; declare `trip/[id]`, `shipment/[orderNum]`, `settings` on the root stack |
| `apps/mobile/app/trip/_layout.tsx`                                       | **delete**                                                                                   |
| `apps/mobile/app/shipment/_layout.tsx`                                   | **delete**                                                                                   |
| `apps/mobile/app/(drawer)/settings.tsx` → `apps/mobile/app/settings.tsx` | `git mv` + import depth fix                                                                  |
| `apps/mobile/app/(drawer)/_layout.tsx`                                   | Drop the hidden `settings` `Drawer.Screen`                                                   |
| `apps/mobile/app/(auth)/login.tsx`                                       | `resetToEmailStep()` + back control on the `password` and `providers` steps                  |

## Tests

`jest.setup.js:72-93` mocks `expo-router` with `Stack` as a `jest.fn` and
`Stack.Screen` as `jest.fn(() => null)`, so layout options are asserted by
inspecting `mock.calls` — the pattern `__tests__/app/_layout.test.tsx:83-86`
already uses for `Stack.Protected`. Note the mock exports `useRouter` (with `back`)
but **not** the `router` singleton, `useNavigation`, or `Redirect`; nothing in this
plan needs them, so the mock stays as-is.

- **`__tests__/app/_layout.test.tsx`** — assert `Stack.Screen` is called with
  `name: 'trip/[id]'`, `'shipment/[orderNum]'` and `'settings'`, each with options
  containing `headerShown: true` and `headerBackTitle: 'Back'`. This is the
  regression guard: it fails the moment someone re-nests these under a child stack.
  Assert too that all three render within the `guard={isAuthenticated}` Protected
  subtree, so the guard from §2 can't silently regress.
- **`__tests__/app/(drawer)/settings.test.tsx` → `__tests__/app/settings.test.tsx`** —
  `git mv`, update the `SettingsScreen` import to `../../app/settings` and the three
  `jest.mock('../../../src/…')` paths to `../../src/…`.
- **`__tests__/app/(auth)/login.test.tsx`** — advance to the password step, press
  "Use a different email", assert the email input renders again and the password
  field is gone.

## Verification

1. `npm test -w apps/mobile` — jest, including the new/moved specs above.
2. `npm run typecheck && npm run lint` from the repo root. `apps/mobile` is under
   both turbo gates since #606; don't skip them.
3. **Manual, on an iOS simulator or device** — this is the only check that actually
   proves the chevron renders, since jest asserts config rather than UIKit:
   `cd apps/mobile && npx expo start` (or `npm run ios`), then walk
   - Dashboard → My Trips → a trip → a shipment: chevron + "Back" label at each
     level, and the iOS left-edge swipe pops correctly.
   - Avatar menu → Settings: chevron back to the screen you came from.
   - Login: enter an email → password step → "Use a different email" returns to
     the email step with the field editable.
4. Confirm no regression in the push deep link: a `trip.assigned` tap still lands on
   `/trip/:id` and now shows a back button to the trips list.

**Housekeeping:** `npm test` at the repo root rewrites `apps/api/vitest.config.ts`
coverage thresholds and dirties `apps/e2e/.env.test` — `git checkout --` both before
staging.

**Shipping note:** merging to `main` does not put this on a driver's phone. It reaches
users only through a new EAS build plus a TestFlight / Play closed-testing release.
