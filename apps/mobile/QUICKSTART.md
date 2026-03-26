# Quick Start Guide

This guide will get you up and running in 5 minutes.

## Step 1: Push to GitHub

```bash
# Create a new repository on GitHub (don't initialize with README)
# Then run these commands:

git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

## Step 2: Set Up Expo Account (for deployment)

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to Expo (create account if needed)
npx expo login

# Configure EAS
eas build:configure
```

## Step 3: Add GitHub Secrets

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add a new secret:
   - Name: `EXPO_TOKEN`
   - Value: Run `npx expo whoami --token` and paste the token

## Step 4: Test Locally

```bash
# Run tests
npm test

# Start the development server
npm start
```

## Step 5: Deploy

### Option A: Automatic (via GitHub Actions)

- Push to `main` branch - automatic deployment starts
- Check the "Actions" tab in GitHub to monitor progress

### Option B: Manual

```bash
# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios

# Submit to stores
eas submit --platform android
```

## Understanding the CI/CD Pipeline

The workflow automatically:

1. ✅ Runs tests on every PR and push
2. 📦 Builds preview on PRs
3. 🚀 Deploys to staging when pushing to `develop`
4. 📱 Deploys to production (stores) when pushing to `main`

## Next Steps

- Customize the image in `App.tsx`
- Add more components and tests
- Configure app.json with your app details
- Set up app store listings

## Common Commands

```bash
# Development
npm start              # Start Expo dev server
npm run android        # Run on Android
npm run ios            # Run on iOS
npm run web            # Run on web

# Testing
npm test               # Run tests once
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report

# Building
eas build --platform all    # Build for both platforms
eas build --platform android --profile preview  # Build preview
```

## Troubleshooting

**Tests failing?**

- Make sure you ran `npm install --legacy-peer-deps`
- Clear cache: `npm test -- --clearCache`

**Build failing?**

- Check that EXPO_TOKEN is set in GitHub secrets
- Verify EAS is configured: `eas build:configure`

**Can't run on device?**

- Install Expo Go app on your phone
- Scan QR code from `npm start`

## Need Help?

- Expo docs: https://docs.expo.dev
- React Native Testing Library: https://callstack.github.io/react-native-testing-library/
- GitHub Actions: https://docs.github.com/en/actions
