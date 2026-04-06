// Setup file for jest tests
// Built-in matchers are now included in @testing-library/react-native v12.4+

// react-native@0.81.6 bundles a renderer built against react@19.1.4. It performs
// a strict React.version === "19.1.4" check at renderer load time. The workspace
// installs react@19.1.5 (same API, newer patch), so we spoof the version string
// before any renderer is loaded to pass the check in the test environment.
const React = require('react');
Object.defineProperty(React, 'version', { configurable: true, writable: true, value: '19.1.4' });

// Global cleanup after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global cleanup after all tests
afterAll(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

// Mock expo-constants
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_ENV: 'test',
      },
      version: '1.0.0',
    },
  },
}));

// Mock expo-router
jest.mock('expo-router', () => {
  const React = require('react');
  const StackMock = jest.fn(({ children }) => React.createElement(React.Fragment, null, children));
  StackMock.Screen = jest.fn(() => null);
  StackMock.Protected = jest.fn(({ children }) => React.createElement(React.Fragment, null, children));
  return {
    useRouter: jest.fn(() => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
    })),
    useLocalSearchParams: jest.fn(() => ({})),
    useSegments: jest.fn(() => []),
    Stack: StackMock,
    Tabs: jest.fn(({ children }) => React.createElement(React.Fragment, null, children)),
    Link: jest.fn(({ children }) => React.createElement(React.Fragment, null, children)),
    SplashScreen: {
      preventAutoHideAsync: jest.fn(() => Promise.resolve()),
      hideAsync: jest.fn(() => Promise.resolve()),
    },
  };
});

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' })
  ),
  launchCameraAsync: jest.fn(() =>
    Promise.resolve({
      canceled: false,
      assets: [{ uri: 'mock://photo.jpg' }],
    })
  ),
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => React.createElement('SafeAreaProvider', null, children),
    SafeAreaView: ({ children, style }) => React.createElement('SafeAreaView', { style }, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// Mock logger
jest.mock('./src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    logAuth: jest.fn(),
    logOrderStatusChange: jest.fn(),
    logCameraCapture: jest.fn(),
    logOrderLoad: jest.fn(),
    logNavigation: jest.fn(),
  },
}));
