# Pegasus Mobile — Driver App

A production-ready React Native app built with Expo for truck drivers to manage moving and storage orders.

## Features

### Core Functionality

- **Driver Authentication**: Mock login with AsyncStorage session persistence
- **Order Dashboard**: List view of all assigned orders with status indicators
- **Order Details**: Complete order information including customer, locations, and inventory
- **Status Management**: Update orders through workflow (Pending → In Transit → Delivered)
- **Proof of Delivery**: Camera integration for capturing delivery photos
- **Settings**: Driver profile, app info, and account management

### UI/UX

- **Trucker-Friendly Design**: High contrast colors, large fonts (18pt+), and touch targets (48px+)
- **Status-Coded**: Color-coded badges (Yellow=Pending, Blue=In Transit, Green=Delivered)
- **Responsive**: Works on all screen sizes (phones and tablets)
- **TypeScript**: Full type safety with complete data schema

## Tech Stack

- **Framework**: React Native with Expo SDK 54
- **Routing**: Expo Router (file-based routing)
- **State Management**: React Context + AsyncStorage
- **Styling**: StyleSheet with design system
- **Permissions**: Camera, Photo Library, Location
- **TypeScript**: Full type safety

## Prerequisites

- Node.js 18+
- npm or yarn
- Expo account (for building)
- EAS CLI (for deployment)

## Getting Started

### Installation

```bash
# Install dependencies
npm install
```

### Running the App

```bash
# Start the development server
npm start

# Run on device
# - Press 'i' for iOS simulator
# - Press 'a' for Android emulator
# - Scan QR code with Expo Go app
```

### Demo Credentials

Login with any email and password (minimum 4 characters).

Example:

- Email: `driver@test.com`
- Password: `test1234`

## Mock Data

The app includes 4 sample orders with different statuses:

- **Order #12345**: Pending (LA to San Francisco)
- **Order #12346**: In Transit (San Diego to Phoenix)
- **Order #12347**: Delivered (Las Vegas to Reno)
- **Order #12348**: Pending (Oakland to Sacramento)

## Data Schema

### TruckingOrder Interface

```typescript
{
  orderId: string;
  orderNumber: string;
  pickup: LocationData;
  dropoff: LocationData;
  inventory: InventoryItem[];
  customer: CustomerInfo;
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled';
  proofOfDelivery?: ProofData;
  assignedDriverId: string;
  createdAt: string;
  updatedAt: string;
}
```

See `src/types/index.ts` for complete schema

## Building for Production

### Prerequisites

1. Create Expo account: https://expo.dev
2. Install EAS CLI: `npm install -g eas-cli`
3. Login: `eas login`
4. Configure: `eas build:configure`

### Build Commands

**Preview (Internal Testing):**

```bash
eas build --platform all --profile preview
```

**Production (App Stores):**

```bash
eas build --platform all --profile production
```

### iOS Device Registration

For preview builds, register devices:

```bash
eas device:create
```

See **DEPLOYMENT_GUIDE.md** for complete instructions

## Project Structure

```
minimal-rn-app/
├── app/
│   ├── (auth)/
│   │   ├── login.tsx              # Login screen
│   │   └── _layout.tsx
│   ├── (tabs)/
│   │   ├── index.tsx              # Dashboard (order list)
│   │   ├── settings.tsx           # Settings screen
│   │   └── _layout.tsx            # Tab navigation
│   ├── order/
│   │   ├── [id].tsx               # Order detail screen
│   │   └── _layout.tsx
│   ├── _layout.tsx                # Root layout with auth guard
│   └── +not-found.tsx
├── src/
│   ├── components/
│   │   ├── OrderCard.tsx          # Order list item
│   │   └── StatusBadge.tsx        # Status indicator
│   ├── context/
│   │   └── AuthContext.tsx        # Authentication provider
│   ├── services/
│   │   ├── mockData.ts            # Sample orders
│   │   └── orderService.ts        # Order CRUD operations
│   ├── theme/
│   │   └── colors.ts              # Design system
│   └── types/
│       └── index.ts               # TypeScript interfaces
├── eas.json                       # EAS Build configuration
├── app.json                       # Expo configuration
├── DEPLOYMENT_GUIDE.md            # Complete deployment instructions
└── README.md                      # This file
```

## App Store Submission

### Bundle Identifiers

- **iOS**: `com.movingstorage.driverapp`
- **Android**: `com.movingstorage.driverapp`

### Required Accounts

- **Apple Developer**: $99/year (https://developer.apple.com)
- **Google Play Console**: $25 one-time (https://play.google.com/console)

### Required Assets

- App icon: 1024x1024 PNG
- Screenshots: iPhone 6.7" and Android
- Privacy Policy URL
- App description

## Testing

Run tests:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

## Scripts

```bash
npm start          # Start Expo dev server
npm run android    # Run on Android
npm run ios        # Run on iOS
npm run web        # Run in browser
npm test           # Run tests
```

## Troubleshooting

### App Won't Start

```bash
# Clear cache
npx expo start -c
```

### Build Fails

```bash
# Clear EAS cache
eas build --platform [ios|android] --clear-cache
```

### Camera Not Working

Ensure permissions are granted in device settings:

- iOS: Settings → [App Name] → Camera
- Android: Settings → Apps → [App Name] → Permissions

## App Store Compliance

This app meets Apple App Store Guideline 4.2 (Minimum Functionality) requirements:

- Persistent login/logout
- Data display (order list)
- Interactive features (status updates, photo capture)
- Settings and account management
- Clear user value (order management for drivers)

## License

Proprietary - All rights reserved

---

**Version**: 1.0.0
**Last Updated**: December 2025
**Expo SDK**: 54.0.0
