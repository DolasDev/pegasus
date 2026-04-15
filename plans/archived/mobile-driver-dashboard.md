# Mobile Driver Dashboard Screen

## Goal

Add a driver-focused dashboard as the primary landing screen in the mobile app, with a hamburger drawer for navigation and a user menu in the top bar. The existing order list ("Paperwork") becomes a drawer destination rather than the root screen.

## Scope

In scope:

- New Dashboard screen with placeholder metric cards (Account Balance, Active Shipments, Pending Settlement Total, plus 1–2 more driver-relevant tiles).
- Left-side hamburger drawer with one item: **Paperwork** → navigates to the current order list screen.
- Top bar: hamburger icon on the left, tappable logged-in user affordance on the right (avatar/initials + name) that opens a menu or sheet with **Settings** and **Logout**.
- Wire drawer as the new navigation root; reuse existing order and settings routes underneath.

Out of scope:

- Real metric data / API integration (use hardcoded placeholders typed by a `DriverMetrics` shape so a future PR can swap to a query).
- New backend endpoints.
- Design system overhaul — use existing `src/theme/colors.ts` tokens and modern conventions for anything unspecified.

## Current State

- `apps/mobile/app/(tabs)/_layout.tsx` — tab navigator with `index` (Orders) and `settings`.
- `apps/mobile/app/(tabs)/index.tsx` — order list, currently the landing screen.
- `apps/mobile/app/(tabs)/settings.tsx` — settings screen with logout.
- `apps/mobile/src/context/AuthContext.tsx` — provides current user + logout.
- No drawer navigator is installed yet.

## Approach

1. **Install drawer dependency.** Add `@react-navigation/drawer` and its peers (`react-native-gesture-handler`, `react-native-reanimated` — confirm presence first; expo SDK usually includes them). Register gesture-handler import at app entry if missing.

2. **Replace `(tabs)` group with `(drawer)` group.**
   - New `apps/mobile/app/(drawer)/_layout.tsx` using expo-router `Drawer` from `expo-router/drawer`.
   - Screens under the drawer:
     - `index.tsx` → new Dashboard (driver metrics).
     - `paperwork.tsx` → renders the existing order list (move `OrderListScreen` body into a shared component in `src/screens/PaperworkScreen.tsx` and import from both old and new routes, or simply move the file).
     - `settings.tsx` → keep existing settings; hide from drawer (`drawerItemStyle: { display: 'none' }`) since it's reached via the user menu.
   - Delete `(tabs)` group once routes are migrated and tests updated.

3. **Dashboard screen (`app/(drawer)/index.tsx`).**
   - New component `src/components/MetricCard.tsx` — label, value, optional trend/subtitle, themed via `colors`.
   - New hook/stub `src/services/driverMetrics.ts` exporting `getDriverMetrics(): Promise<DriverMetrics>` with hardcoded placeholders (`accountBalance`, `activeShipments`, `pendingSettlementTotal`, `completedThisWeek`, `milesThisWeek`).
   - Layout: `SafeAreaView` + scrollable grid (2 columns) of `MetricCard`s. Pull-to-refresh wired to re-call the stub.

4. **Top bar.**
   - Configure `Drawer.screenOptions.headerLeft` to render a hamburger `Pressable` calling `navigation.openDrawer()` (icon: `@expo/vector-icons` `Ionicons` `menu` — already transitively available via expo).
   - `headerRight` renders a new `src/components/UserMenuButton.tsx` — reads user from `AuthContext`, shows initials + name, on press opens a small menu. Use `Modal` + absolute-positioned card (no extra dep) with two rows: **Settings** → `router.push('/settings')`, **Logout** → `auth.logout()`.

5. **Drawer content.**
   - Custom `drawerContent` that renders a header (app name + logged-in user) and a single item "Paperwork" navigating to `/paperwork`. Use `DrawerContentScrollView` + `DrawerItem` from `@react-navigation/drawer`.

6. **Tests.**
   - Snapshot test for Dashboard (`src/components/__tests__/Dashboard.snapshot.test.tsx` already exists — update to new component).
   - Unit test for `MetricCard` rendering value + label.
   - Smoke test: drawer layout renders without crashing; user menu opens on press; selecting Logout calls `auth.logout`.
   - Update any existing tests that import the old `(tabs)` path.

7. **Manual verification.** Run `npm run dev` in `apps/mobile`, confirm dashboard loads, hamburger opens drawer, Paperwork navigates to order list, user menu shows Settings + Logout and both work.

## Design Decisions (defer to modern conventions)

- Card radius, spacing, and typography: follow existing `colors.ts` / `spacing` tokens; fall back to RN defaults.
- Currency formatting: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` for balance / settlement.
- Drawer width: default (`'80%'` on phones).
- Icon set: `@expo/vector-icons` Ionicons.

## Files Touched (expected)

- `apps/mobile/package.json` — add drawer deps.
- `apps/mobile/app/(drawer)/_layout.tsx` (new)
- `apps/mobile/app/(drawer)/index.tsx` (new — Dashboard)
- `apps/mobile/app/(drawer)/paperwork.tsx` (new — wraps existing order list)
- `apps/mobile/app/(drawer)/settings.tsx` (moved from tabs)
- `apps/mobile/app/(tabs)/*` (deleted)
- `apps/mobile/src/components/MetricCard.tsx` (new)
- `apps/mobile/src/components/UserMenuButton.tsx` (new)
- `apps/mobile/src/components/DrawerContent.tsx` (new)
- `apps/mobile/src/services/driverMetrics.ts` (new — stub)
- `apps/mobile/src/types.ts` — add `DriverMetrics`.
- Tests as listed above.

## Risks

- Drawer on expo-router sometimes needs `react-native-gesture-handler` import at the very top of the app entry; forgetting it causes silent gesture failures. Check `App.tsx` / `index.ts` before finishing.
- Moving the tabs group changes deep-link paths — search the codebase for `/order/` / `/(tabs)/` references and update.
- Existing tests import from `app/(tabs)/...`; update paths or tests will break.

## Acceptance Criteria

- App launches into Dashboard showing placeholder metric tiles.
- Tapping hamburger icon opens left drawer; "Paperwork" navigates to the existing order list which remains fully functional (including order detail navigation).
- Top-right user control shows the logged-in user's name/initials; tapping opens a menu with Settings and Logout that work.
- `npm test` passes in `apps/mobile`; `npm run typecheck` clean.
