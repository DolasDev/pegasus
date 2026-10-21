// Setup file for jest tests
// Built-in matchers are now included in @testing-library/react-native v12.4+

// Provide EXPO_PUBLIC_COGNITO_* env vars so getMobileConfig() works in tests
// that import modules calling it at module scope (e.g. _layout.tsx).
process.env.EXPO_PUBLIC_API_URL = 'http://localhost:3000'
process.env.EXPO_PUBLIC_COGNITO_REGION = 'us-east-1'
process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID = 'us-east-1_TestPool123'
process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = 'test-mobile-client-id'
process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'https://pegasus-test.auth.us-east-1.amazoncognito.com'
process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI = 'movingapp://auth/callback'

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

// Mock expo-notifications (native module; not transformed by jest). Defaults to
// permission granted + a stub token so push code paths are exercisable.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3 },
}));

// Mock expo-device — default to non-physical so registerForPush() no-ops in
// tests (a physical device is required for real push tokens).
jest.mock('expo-device', () => ({ isDevice: false }));

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
    // Tests have no navigator, so "focus" is simply mount (and a changed callback).
    useFocusEffect: jest.fn((effect) => React.useEffect(() => effect(), [effect])),
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

// Mock expo-web-browser
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'cancel' })),
  dismissBrowser: jest.fn(),
}));

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn((size) => Promise.resolve(new Uint8Array(size).fill(65))),
  digestStringAsync: jest.fn(() => Promise.resolve('bW9jay1kaWdlc3Q')),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
  // A distinct v4-shaped id per call, like the real one.
  randomUUID: jest.fn(() => {
    globalThis.__mockUuidSeq = (globalThis.__mockUuidSeq ?? 0) + 1;
    return `00000000-0000-4000-8000-${String(globalThis.__mockUuidSeq).padStart(12, '0')}`;
  }),
}));

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

// Mock expo-contacts (native module). Defaults to full access and an empty
// address book; the Labor import tests override per case.
jest.mock('expo-contacts', () => ({
  getPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true, canAskAgain: true, accessPrivileges: 'all' })
  ),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', granted: true, canAskAgain: true, accessPrivileges: 'all' })
  ),
  getContactsAsync: jest.fn(() => Promise.resolve({ data: [], hasNextPage: false, hasPreviousPage: false })),
  presentAccessPickerAsync: jest.fn(() => Promise.resolve([])),
  Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers', Emails: 'emails' },
  SortTypes: { FirstName: 'firstName', LastName: 'lastName' },
}));

// Mock expo-sharing (native module).
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
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
    transport: { log: jest.fn() },
    logAuth: jest.fn(),
    logOrderStatusChange: jest.fn(),
    logCameraCapture: jest.fn(),
    logOrderLoad: jest.fn(),
    logNavigation: jest.fn(),
  },
}));
