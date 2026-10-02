# Enable R8 for Android release builds

**Branch:** `fix/android-r8-minify` (worktree `../pegasus-android-r8-minify`)

## Why

Play Console flagged the driver app (vcode 16): "DEX code optimization is below
our threshold — Obfuscation (1%)". Under 25% in any category "may impact your
visibility and publishing capabilities", with a deadline.

Root cause: `android/` is gitignored (CNG — EAS prebuilds it from `app.json`).
The generated `android/app/build.gradle` reads
`android.enableMinifyInReleaseBuilds` from gradle properties and defaults it to
`false`; nothing sets it, and `expo-build-properties` (the plugin that writes
those properties) isn't installed. So R8 never ran on a release AAB.

## Change

1. `npx expo install expo-build-properties` in `apps/mobile` (SDK-55-matched version).
2. `app.json` `plugins` +=
   `["expo-build-properties", { "android": { "enableMinifyInReleaseBuilds": true, "enableShrinkResourcesInReleaseBuilds": true } }]`
3. Verify with `npx expo prebuild --platform android --no-install` into a scratch
   copy that `gradle.properties` carries both flags (prebuilt `android/` stays
   untracked).
4. Document in `dolas/agents/project/GOTCHAS.md`: R8 is opt-in under CNG, and
   `eas submit` doesn't upload `mapping.txt`.

No version bump: `eas.json` `production` has `autoIncrement` + `appVersionSource: remote`.

## Files

- `apps/mobile/package.json`, `package-lock.json`
- `apps/mobile/app.json`
- `dolas/agents/project/GOTCHAS.md`
- `plans/in-progress/android-r8-minify.md` (this file → `plans/completed/` before PR)

## Release (after merge — user-run or with approval)

- Dispatch `mobile-release.yml` Android with submit → vcode 17 on alpha.
- **Device smoke test before promoting:** login (password + SSO), trip list/detail,
  document scan → upload (react-native-document-scanner-plugin is the most
  likely R8 casualty), push notification receipt.
- Upload `mapping.txt` from the EAS build artifacts to Play Console
  (App bundle explorer → Downloads → ReTrace mapping file).

## Risks

- R8 strips reflection-only classes → runtime crash. Mitigated by the smoke test
  on the alpha track; rollback = remove the plugin entry and rebuild.

## Verification log

- `expo install` resolved `expo-build-properties@~55.0.18`. npm 11 pruned unrelated
  nested lock entries, so the lock was regenerated with the pinned `npm@10.8.2`
  (`install --package-lock-only`): +15 lines, 0 removed.
- Scratch prebuild: `android/gradle.properties` has
  `android.enableMinifyInReleaseBuilds=true` and
  `android.enableShrinkResourcesInReleaseBuilds=true`; `build.gradle` wires both
  into `minifyEnabled` / `shrinkResources`.
- Local `:app:assembleRelease` could NOT run here: RN's gradle plugin asks for
  `jvmToolchain(17)`, the machine has only JDK 8/21, and Gradle's foojay
  auto-provisioner (0.5.0) crashes on Gradle 9 (`JvmVendorSpec.IBM_SEMERU`).
  EAS images ship JDK 17. So the first R8 build is the EAS build: an R8
  missing-class error fails that build, and nothing reaches the store. Runtime
  reflection issues still need the device smoke test on alpha.
