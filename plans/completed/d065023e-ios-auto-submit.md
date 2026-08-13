# Wire iOS auto-submit to TestFlight / App Store

## Why

Apple Developer enrollment is complete and the signing credentials now exist on
EAS (Distribution Certificate `1DD64D...`, App Store provisioning profile
`54TZ7K8T77`, APNs key, and an App Store Connect API key — all under team
`9NJ2BGU4TR`). #590 already made CI able to _build_ a signed store `.ipa`
(`ios_build=store` → the `production` eas.json profile), but the artifact then
sits on EAS servers with no way to reach App Store Connect: `submit.production.ios`
still holds `PLACEHOLDER`s and the `submit` input is gated on Android only.

This closes the last gap, giving iOS the same dispatch-and-forget release path
Android already has.

## Scope

1. **`apps/mobile/eas.json`** — `submit.production.ios`:
   - `ascAppId: "6800979383"` (App Store Connect app record)
   - `appleTeamId: "9NJ2BGU4TR"`
   - **drop `appleId`** entirely. The ASC API key stored on EAS authenticates
     submissions; an Apple ID is dead config, and leaving a placeholder invites
     someone to "fix" it with a real address that is never read.

2. **`.github/workflows/mobile-release.yml`**:
   - `resolve` job: add `do_ios_submit`, true only when
     `do_ios && ios_build == 'store' && submit`. Simulator and device artifacts
     are not submittable, so they must never pick up the flag.
   - `build-ios` step: append `--auto-submit` when `do_ios_submit`. The flag
     resolves the submit profile by build-profile name — `store` maps to the
     `production` build profile, which pairs with the `production` submit
     profile. That name match is what makes this work; keep it.
   - `submit` input description: currently Android-only, now covers both.
   - Header comment: replace the "iOS auto-submit is still not wired /
     PLACEHOLDERs pending an App Store Connect API key" paragraph.
   - **Backward compatibility is a hard requirement**: a `platform=android`
     dispatch with default inputs must behave byte-identically to today. The
     existing `do_submit` logic is not to be restructured, only added alongside.

3. **`apps/mobile/app.json`** — add `"ITSAppUsesNonExemptEncryption": false` to
   `ios.infoPlist`. This is an **export-compliance declaration**, not a config
   tweak: the app uses only HTTPS/TLS and Keychain via `expo-secure-store`, all
   exempt under the standard-encryption exemption. Without it App Store Connect
   blocks every single build behind a manual questionnaire.

4. **Docs** — these describe a world that stopped existing tonight:
   - `PUSH_NOTIFICATIONS.md`: the "iOS delivery" status row, and the Step 2
     narrative asserting `iosAppCredentials` is still `[]`. **Leave the Android
     row alone** — the FCM V1 server key (Step 1.6) is still genuinely pending.
   - `DEPLOYMENT_GUIDE.md`: drop the "Apple Developer credentials we don't have
     yet" sections; add `-f ios_build=store -f submit=true` to the example
     dispatch.

## Out of scope

- The ad-hoc `ios-device` credential set (needs `eas device:create`) — separate
  concern, only matters for on-device push testing.
- App Store _listing_ work: screenshots, privacy policy, App Privacy answers,
  and the reviewer demo account. Those gate public release, not the pipeline.

## Verification

No test or lint gate covers these files — there is no actionlint in CI — so the
`resolve` job's bash gets eyeballed carefully, and the `case` statement and new
conditional get traced by hand for all input combinations:

| platform | ios_build | submit | expect                                  |
| -------- | --------- | ------ | --------------------------------------- |
| android  | (any)     | true   | Play alpha submit, unchanged from today |
| android  | (any)     | false  | build only, unchanged from today        |
| ios      | simulator | true   | build only, no submit                   |
| ios      | device    | true   | build only, no submit                   |
| ios      | store     | true   | build + TestFlight submit               |
| ios      | store     | false  | build only                              |
| all      | store     | true   | both submit                             |

The genuine empirical test is the first `ios_build=store` dispatch.

**Known unverified dependency**: the ASC API key is confirmed present on the EAS
dashboard, but its binding as the _submissions_ key is user-attested, not proven.
If the first submit fails with a missing-API-key error, the fix is one pass
through `eas credentials --platform ios` → App Store Connect API Key → "set up
your project to use", not a change to anything in this PR.
