# Minimal React Native App

A minimal React Native application built with Expo, featuring comprehensive testing and automated CI/CD pipeline.

## 🎯 Features

- **Minimal UI**: Displays a single image (meets App Store requirements)
- **TypeScript**: Full type safety
- **100% Test Coverage**: Comprehensive unit tests with Jest
- **CI/CD Pipeline**: Automated testing and deployment via GitHub Actions
- **Modern Stack**: Uses latest stable versions of React Native and Expo

## 📋 Prerequisites

- Node.js 20 or higher
- npm or yarn
- Expo CLI (optional, installed locally)
- For deployment: Expo account and EAS CLI

## 🚀 Getting Started

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd minimal-rn-app

# Install dependencies
npm install --legacy-peer-deps
```

### Running the App

```bash
# Start the development server
npm start

# Run on Android
npm run android

# Run on iOS (macOS only)
npm run ios

# Run on web
npm run web
```

## 🧪 Testing

### Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Test Coverage

The app maintains 100% test coverage on all source files:
- Component rendering tests
- Image display verification
- Structure validation

## 🔄 CI/CD Pipeline

The project includes a GitHub Actions workflow that:

1. **On Pull Requests**:
   - Runs all tests
   - Generates coverage reports
   - Builds a preview version

2. **On Push to `develop` branch**:
   - Runs all tests
   - Publishes to Expo staging channel

3. **On Push to `main` branch**:
   - Runs all tests
   - Builds Android APK/AAB
   - Builds iOS IPA
   - Submits to Google Play Internal Testing

### Setting Up CI/CD

To enable automated deployment, add these secrets to your GitHub repository:

1. **EXPO_TOKEN**: Your Expo access token
   - Get it by running: `npx expo login` then `npx expo whoami --token`

2. Configure EAS (Expo Application Services):
   ```bash
   npm install -g eas-cli
   eas login
   eas build:configure
   ```

## 📁 Project Structure

```
minimal-rn-app/
├── .github/
│   └── workflows/
│       └── ci-cd.yml          # GitHub Actions workflow
├── assets/                     # Images and static assets
├── App.tsx                     # Main app component
├── App.test.tsx               # App tests
├── index.ts                    # App entry point
├── babel.config.js            # Babel configuration
├── jest.config.js             # Jest configuration
├── jest.setup.js              # Jest setup file
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

## 🛠️ Technology Stack

- **React Native**: 0.81.5
- **Expo**: ~54.0.30
- **TypeScript**: ~5.9.2
- **Jest**: Latest
- **React Native Testing Library**: Latest

## 📝 Development Workflow

1. Create a new branch for your feature
2. Make changes and write tests
3. Run `npm test` to ensure all tests pass
4. Push to GitHub - CI will run automatically
5. Create a PR to `develop` for staging deployment
6. Merge to `main` for production deployment

## 🔧 Configuration Files

- **babel.config.js**: Configures Babel for TypeScript and React Native
- **jest.config.js**: Configures Jest testing framework
- **tsconfig.json**: TypeScript compiler options
- **app.json**: Expo configuration

## 📱 Deployment

### Manual Deployment

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios

# Submit to stores
eas submit --platform android
eas submit --platform ios
```

### Automated Deployment

Deployment happens automatically via GitHub Actions:
- Push to `develop` → Publishes to Expo staging
- Push to `main` → Builds and submits to app stores

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Built with Expo for simplified React Native development
- Uses Testing Library for clean, maintainable tests
- GitHub Actions for reliable CI/CD
