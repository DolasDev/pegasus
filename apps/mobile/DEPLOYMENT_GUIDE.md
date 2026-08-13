# Moving & Storage Driver App - Deployment Guide

## Overview

This guide provides step-by-step instructions for building and deploying the Moving & Storage Driver app to iOS and Android devices using Expo Application Services (EAS).

---

## Release pipeline (canonical path)

Releases are cut **manually and deliberately** via the
`.github/workflows/mobile-release.yml` workflow — you don't run `eas build`/`eas
submit` by hand, but you do decide when a release happens. The manual EAS
commands below are the fallback / first-time bootstrap.

**How it works**

- **Trigger** — `workflow_dispatch` only (Actions tab → "Mobile release" → Run
  workflow): choose `env` (which backend config to bake in), `platform`
  (android / ios / all), `ios_build` (simulator / device / store), and `submit`
  (auto-submit after the build).
  Dispatching **is** the release gate — there is no auto-on-push, deliberately:
  the app bundles shared packages, so pushes would fire on unrelated backend
  merges, and EAS free-tier queues outlive a synchronous CI job.
- **Android** — `eas build --no-wait --auto-submit` hands the AAB build **and**
  the Google Play submit to EAS's servers and returns immediately. So the CI run
  confirms the build was _accepted_, not that it finished — watch progress and
  the final result on the **EAS dashboard**
  (`expo.dev/accounts/dolas.dev/projects/moving-storage-driver/builds`). The
  submit lands on the **Closed testing** (`alpha`) track (interim until Google
  grants production access; then flip `submit.production.android.track` to
  `production`).
- **iOS** — `ios_build` picks the artifact: `simulator` (unsigned, CI signal,
  the default), `device` (signed ad-hoc `.ipa` for a device registered via
  `eas device:create`), or `store` (signed `.ipa` for TestFlight/App Store).
  Only `store` submits, and it lands in **TestFlight** — release to the App
  Store is a manual act in App Store Connect. Apple signing credentials live on
  EAS (team `9NJ2BGU4TR`); see `PUSH_NOTIFICATIONS.md` §Step 2 to regenerate.

  ```
  gh workflow run mobile-release.yml --ref main -f env=prod -f platform=ios -f ios_build=store -f submit=true
  ```

- **Config** — API URL + Cognito are resolved from SSM into `apps/mobile/.env`
  at build time (`.github/actions/mobile-eas-config`), and the EAS build runs on
  **Node 24** (`eas.json` build profiles pin `node` — EAS's default Node 20
  fails the repo's `engines` requirement at `npm ci`).
- **Versioning** — `eas.json` uses `cli.appVersionSource: "remote"` +
  `production.autoIncrement: true`; EAS owns a monotonic Android `versionCode`.
  The user-facing `version` in `app.json` is still bumped **manually** for each
  marketing release.
- **Staged rollout** — the submit lands the release; set the rollout
  **percentage** with the Play Console rollout slider afterward (full
  API-driven staged rollout is a deferred follow-up).

> This pipeline is intentionally **separate** from `deploy.yml`/`_deploy.yml`
> (CDK-only) and is **not** part of the `deploy-manifest.json` component set.

### One-time bootstrap — must be fully complete _before_ the pipeline can publish

This is a go-live gate, not parallel work. In order:

1. **EAS account/ownership** — migrate the project off the personal
   `owner` in `app.json` to an Expo **org / robot account** (an unattended
   auto-submit pipeline must not hinge on one person's personal login). Confirm
   the plan's build-credit allotment covers the push frequency (each
   mobile-touching push = 1 Android + 1 iOS-simulator cloud build).
2. **Google Play Console** ($25 one-time) — create the app for
   `com.movingstorage.driverapp` and complete the entire "Set up your app"
   checklist: privacy policy URL, content rating, target audience, **data
   safety**, ads declaration, and full store listing (see §Google Play below).
   These are enforced **per-submission** — an incomplete section rejects _every_
   future `eas submit`, automated or not.
3. **First AAB, uploaded manually** — Google forbids the API from creating a
   brand-new app's first release. Build one AAB
   (`eas build --profile production --platform android`), upload it via the
   Console UI (Internal testing is the lowest-friction track), accept **Play App
   Signing**, and publish. The **first review can take days** — it must be
   live/approved before the pipeline's first real submit.
4. **Service account** — Play Console → Setup → API access → link a GCP project →
   create a service account + JSON key. Play Console → Users and permissions →
   invite the SA email and grant least-privilege **single-app** release access.
5. **Register the key with EAS** — `eas credentials` → Android → _Google Service
   Account Key for Submissions_, upload the JSON once. This is why `eas.json`
   has **no** `serviceAccountKeyPath`: the key is EAS-hosted, so no key material
   ever lands on a CI runner. Only `EXPO_TOKEN` needs project access.
6. **Seed the versionCode counter** — `eas build:version:set` so the next
   automated Android `versionCode` is strictly greater than the one you uploaded
   manually in step 3, or the first automated submit fails with "version code
   already used."

After steps 1–6, enable the workflow and watch the first automated run end to
end before treating the pipeline as unattended-safe.

---

## Prerequisites

### 1. Expo Account Setup

- Create a free account at https://expo.dev
- Verify your email address
- Note your username for later use

### 2. Install EAS CLI (If Not Already Installed)

```bash
npm install -g eas-cli
```

### 3. Login to EAS

```bash
eas login
```

Enter your Expo credentials when prompted.

### 4. Link Project to EAS

From the project directory:

```bash
eas build:configure
```

This will generate a unique project ID and update `app.json`.

---

## Building for Internal Testing (Preview Profile)

### Build for Both Platforms Simultaneously

To create internal test builds for Android and iOS:

```bash
eas build --platform all --profile preview
```

This command will:

- Build an **APK** for Android (easy to share and install)
- Build an **IPA** for iOS with ad-hoc provisioning (for registered devices)

### Build for Individual Platforms

**Android Only:**

```bash
eas build --platform android --profile preview
```

**iOS Only:**

```bash
eas build --platform ios --profile preview
```

---

## iOS Device Registration (Required for Preview Builds)

iOS preview builds only work on registered devices. To register driver iPhones:

### Method 1: Register Device Interactively

```bash
eas device:create
```

Follow the prompts:

1. Choose "Website" or "Manual"
2. If "Website": Send the link to the driver, they open it on their iPhone
3. If "Manual": Enter the device UDID manually

### Method 2: Register Multiple Devices

Create a file `devices.txt`:

```
Device Name 1, UDID-HERE
Device Name 2, UDID-HERE
```

Then run:

```bash
eas device:create --devices devices.txt
```

### How to Find iPhone UDID

**Option A: Via Finder (Mac)**

1. Connect iPhone to Mac
2. Open Finder
3. Select iPhone in sidebar
4. Click on phone info to reveal UDID

**Option B: Via Settings (iPhone)**

1. Settings → General → About
2. Scroll to "Serial Number"
3. Tap to reveal UDID

---

## Installing Preview Builds

### Android (APK)

1. After build completes, EAS provides a download link
2. Send link to driver
3. Driver opens link on Android phone
4. Download APK
5. Enable "Install from Unknown Sources" if prompted
6. Install app

### iOS (Ad-Hoc)

1. After build completes, EAS provides a download link
2. Send link to driver (device must be registered first!)
3. Driver opens link on registered iPhone
4. Tap "Install"
5. May need to trust developer in Settings → General → Device Management

---

## Production Builds (App Store & Google Play)

### Build Production Versions

```bash
eas build --platform all --profile production
```

This creates optimized builds for store submission:

- **Android:** App Bundle (.aab) for Google Play
- **iOS:** IPA for App Store Connect

---

## Apple Developer Account

✅ **Done** (2026-08). Enrolled as **Individual**, team `9NJ2BGU4TR`, $99/year.
App Store Connect app record created for `com.movingstorage.driverapp` —
ASC App ID `6800979383`, wired into `eas.json` → `submit.production.ios`.
Signing credentials (distribution certificate, App Store provisioning profile,
APNs key, App Store Connect API key) are hosted by EAS; the setup and
regeneration procedure lives in `PUSH_NOTIFICATIONS.md` §Step 2.

### Still required before public App Store release

TestFlight needs none of this; a public listing needs all of it.

- **Reviewer demo account** — the app is login-walled behind Cognito, so a
  reviewer who can't get in files a Guideline 2.1 rejection. Supply a working
  tenant + driver login under **App Review Information**, with notes covering
  tenant selection and the Hosted-UI SSO flow, and make sure that account has
  seeded shipments — an empty dashboard reads as an incomplete app (4.2).
  Every future update is re-reviewed, so make this a permanent demo tenant.
- **Privacy policy URL** — mandatory, must be live and public.
- **App Privacy questionnaire** — declare what is actually collected (contact
  info, identifiers, camera/photos). Note `NSLocationWhenInUseUsageDescription`
  claims route optimization but nothing in `src/` uses `expo-location`; don't
  declare location collection that doesn't happen.
- **Screenshots** — 6.9" iPhone at 1320×2868. `app.json` sets
  `ios.supportsTablet: true`, which also obliges a 13" iPad set (2064×2752) and
  means reviewers test on iPad; setting it `false` removes both burdens if the
  driver UI isn't genuinely iPad-designed.
- **App icon** — 1024×1024 PNG, no alpha. `assets/icon.png` has an alpha
  channel, but prebuild flattens it for iOS, so this is already satisfied.
- Age rating questionnaire, category (Business), support URL, description
  (4000 char max), keywords (100 char max).
- **Export compliance** — satisfied in config: `app.json` declares
  `ITSAppUsesNonExemptEncryption: false` (HTTPS/TLS and Keychain only, all
  exempt), which is what stops App Store Connect gating every build behind the
  encryption questionnaire.
- **Build toolchain** — Apple requires uploads built with Xcode 26 / iOS 26 SDK
  since 2026-04-28. The `eas.json` iOS profiles pin no `image`, so builds
  inherit the EAS default; if an upload is rejected on SDK version, pin
  `"image": "latest"` on the profile.

---

## Google Play Console Requirements

### Account Setup

1. **Register at:** https://play.google.com/console
2. **Cost:** $25 one-time fee
3. **Payment:** Credit card

### Required Information

- Google account email
- Developer name (shown on store)
- Contact email
- Phone number

### Create App Listing

1. Login to Google Play Console
2. "Create app"
3. Fill in details:
   - **App name:** Moving & Storage Driver
   - **Default language:** English
   - **App or game:** App
   - **Free or paid:** Free (or Paid)
   - **Declarations:** Complete privacy policy & content rating

### Required Assets (Android)

- App icon: 512x512 PNG
- Feature graphic: 1024x500 PNG
- Screenshots: At least 2 (phone and 7" tablet)
- Privacy Policy URL
- App description (4000 characters max)
- Short description (80 characters max)

---

## Submitting to Stores

### iOS (App Store)

#### Through CI (canonical)

```
gh workflow run mobile-release.yml --ref main -f env=prod -f platform=ios -f ios_build=store -f submit=true
```

Builds the signed `.ipa` and auto-submits it to **TestFlight**. Never
`eas build` locally (#541) — CI bakes the environment config. Releasing from
TestFlight to the App Store is manual, in App Store Connect.

#### Submitting an already-built IPA (fallback)

```bash
eas submit --platform ios
```

Uses the same `submit.production.ios` config and the EAS-hosted App Store
Connect API key, so it needs no interactive Apple login.

#### Manual Upload

1. Download IPA from EAS build
2. Use Transporter app (Mac only)
3. Upload to App Store Connect
4. Select build in App Store Connect
5. Submit for review

### Android (Google Play)

#### Using EAS Submit

```bash
eas submit --platform android
```

#### Manual Upload

1. Download AAB from EAS build
2. Login to Google Play Console
3. Go to "Release" → "Production"
4. "Create new release"
5. Upload AAB
6. Complete release notes
7. Submit for review

---

## App Store Review Requirements

### Minimum Functionality (Guideline 4.2)

Our app meets requirements with:

- Login/logout functionality
- Dashboard with order list
- Order detail view with status updates
- Proof of delivery photo capture
- Settings with account management

### Privacy Policy (Required)

**Generate free policy at:**

- https://www.termsfeed.com/privacy-policy-generator/
- https://www.privacypolicies.com/
- https://app.termly.io/

**Include:**

- What data is collected (email, location, photos)
- How data is used (order management, delivery tracking)
- Data storage and security
- User rights (data deletion)

**Host at:** Your company website or free hosting (GitHub Pages, Netlify)

### Content Rating

**iOS:** Complete in App Store Connect
**Android:** Complete questionnaire in Play Console

For this app, likely rating: **Everyone** or **4+**

---

## Build Status & Downloads

### Check Build Status

```bash
eas build:list
```

### Download Build Artifacts

Builds are available:

- On Expo dashboard: https://expo.dev/accounts/[your-username]/projects/moving-storage-driver/builds
- Via CLI: Use download link from build completion
- 90-day retention on free plan

---

## Troubleshooting

### iOS Build Fails - Provisioning

**Solution:** Ensure device UDIDs are registered before building preview

```bash
eas device:list
eas build --platform ios --profile preview --clear-provisioning-profile
```

### Android Build Fails - Keystore

**Solution:** EAS generates keystore automatically. If issues:

```bash
eas credentials --platform android
```

### App Crashes on Launch

**Solution:** Check logs:

```bash
eas build:view [build-id]
```

### Preview Build Won't Install on iPhone

**Possible causes:**

- Device not registered (see "iOS Device Registration")
- Provisioning profile expired (rebuild)
- Wrong build profile used (use `preview` not `production`)

---

## Environment Variables (Future Use)

For production backend integration:

```bash
eas secret:create --scope project --name API_URL --value "https://api.yourcompany.com"
```

Access in app via:

```javascript
import Constants from 'expo-constants'
const apiUrl = Constants.expoConfig?.extra?.API_URL
```

---

## Quick Reference Commands

```bash
# Login
eas login

# Build preview (both platforms)
eas build --platform all --profile preview

# Build production (both platforms)
eas build --platform all --profile production

# Register iOS device
eas device:create

# List builds
eas build:list

# Submit to stores
eas submit --platform ios
eas submit --platform android

# Check credentials
eas credentials --platform ios
eas credentials --platform android
```

---

## Support & Resources

- **EAS Documentation:** https://docs.expo.dev/eas/
- **Expo Forums:** https://forums.expo.dev/
- **App Store Guidelines:** https://developer.apple.com/app-store/review/guidelines/
- **Google Play Policies:** https://play.google.com/about/developer-content-policy/

---

## Next Steps After Deployment

1. **Monitor Reviews:** Respond to user feedback
2. **Analytics:** Add Expo Analytics or Firebase Analytics
3. **Push Notifications:** Pipeline is built and wired — delivery needs the FCM
   (Android) and APNs (iOS) credentials. See [PUSH_NOTIFICATIONS.md](./PUSH_NOTIFICATIONS.md)
4. **Backend Integration:** Replace mock data with real API
5. **OTA Updates:** Use `eas update` for quick fixes without store review

---

## Notes

- **Build Time:** First build may take 15-30 minutes
- **Concurrent Builds:** Free tier allows 1 build at a time
- **Build Credits:** Check https://expo.dev/pricing for limits
- **App Store Review:** Typically 1-3 days for iOS, hours for Android
- **Bundle Identifier:** Cannot be changed after first submission

---

**Document Version:** 1.0
**Last Updated:** December 2025
**App Version:** 1.0.0
