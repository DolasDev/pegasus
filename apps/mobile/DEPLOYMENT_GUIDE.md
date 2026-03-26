# Moving & Storage Driver App - Deployment Guide

## Overview

This guide provides step-by-step instructions for building and deploying the Moving & Storage Driver app to iOS and Android devices using Expo Application Services (EAS).

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

## Apple Developer Account Requirements

### Account Setup

1. **Enroll at:** https://developer.apple.com
2. **Cost:** $99/year
3. **Entity Type:** Choose Individual or Organization
   - Individual: Your personal Apple ID
   - Organization: Requires DUNS number

### Required Information

- Apple ID with 2FA enabled
- Payment method (credit card)
- Company name (if Organization)
- Contact information

### App Store Connect

1. Login to https://appstoreconnect.apple.com
2. Go to "My Apps" → "+"
3. Create new app:
   - **Platform:** iOS
   - **Name:** Moving & Storage Driver
   - **Primary Language:** English
   - **Bundle ID:** com.movingstorage.driverapp (must match app.json)
   - **SKU:** Any unique identifier (e.g., "moving-driver-001")

### Required Assets (iOS)

- App icon: 1024x1024 PNG (no transparency)
- Screenshots: 6.7" iPhone (required), others optional
- Privacy Policy URL
- App description (4000 characters max)
- Keywords (100 characters max)
- Support URL
- Marketing URL (optional)

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

#### Using EAS Submit (Recommended)

```bash
eas submit --platform ios
```

EAS will:

1. Upload the IPA to App Store Connect
2. Handle provisioning automatically
3. Show submission status

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
3. **Push Notifications:** Implement for order updates
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
