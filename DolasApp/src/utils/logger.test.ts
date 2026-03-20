// Must unmock before importing so we test the real implementation,
// not the global mock from jest.setup.js
jest.unmock('@/utils/logger');

describe('Logger', () => {
  let consoleSpy: {
    debug: jest.SpyInstance;
    info: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach((s) => s.mockRestore());
  });

  function getLogger() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@/utils/logger').logger;
  }

  describe('non-production environment (test)', () => {
    let logger: ReturnType<typeof getLogger>;

    beforeEach(() => {
      jest.resetModules();
      // expo-constants is globally mocked with EXPO_PUBLIC_ENV: 'test'
      logger = getLogger();
    });

    it('debug() calls console.debug', () => {
      logger.debug('hello debug');
      expect(consoleSpy.debug).toHaveBeenCalled();
      expect(consoleSpy.debug.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleSpy.debug.mock.calls[0][0]).toContain('hello debug');
    });

    it('info() calls console.info with [INFO] prefix', () => {
      logger.info('hello info');
      expect(consoleSpy.info).toHaveBeenCalled();
      expect(consoleSpy.info.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleSpy.info.mock.calls[0][0]).toContain('hello info');
    });

    it('warn() calls console.warn with [WARN] prefix', () => {
      logger.warn('hello warn');
      expect(consoleSpy.warn).toHaveBeenCalled();
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('[WARN]');
    });

    it('error() calls console.error with [ERROR] prefix', () => {
      logger.error('hello error');
      expect(consoleSpy.error).toHaveBeenCalled();
      expect(consoleSpy.error.mock.calls[0][0]).toContain('[ERROR]');
    });

    it('logAuth("login", email) calls info with "Auth: login"', () => {
      logger.logAuth('login', 'driver@example.com');
      expect(consoleSpy.info).toHaveBeenCalled();
      expect(consoleSpy.info.mock.calls[0][0]).toContain('Auth: login');
    });

    it('logAuth("logout", email) calls info with "Auth: logout"', () => {
      logger.logAuth('logout', 'driver@example.com');
      expect(consoleSpy.info).toHaveBeenCalled();
      expect(consoleSpy.info.mock.calls[0][0]).toContain('Auth: logout');
    });

    it('logOrderStatusChange(id, from, to) calls info with order id', () => {
      logger.logOrderStatusChange('ORD-001', 'pending', 'in_transit');
      expect(consoleSpy.info).toHaveBeenCalled();
      expect(consoleSpy.info.mock.calls[0][0]).toContain('ORD-001');
    });

    it('logCameraCapture(id, count) calls info with order id', () => {
      logger.logCameraCapture('ORD-001', 3);
      expect(consoleSpy.info).toHaveBeenCalled();
      expect(consoleSpy.info.mock.calls[0][0]).toContain('ORD-001');
    });

    it('logOrderLoad(count) calls debug, not info', () => {
      logger.logOrderLoad(10);
      expect(consoleSpy.debug).toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('logNavigation(screen) calls debug, not info', () => {
      logger.logNavigation('HomeScreen');
      expect(consoleSpy.debug).toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });
  });

  describe('production environment', () => {
    let logger: ReturnType<typeof getLogger>;

    beforeEach(() => {
      jest.resetModules();
      jest.mock('expo-constants', () => ({
        __esModule: true,
        default: {
          expoConfig: {
            extra: { EXPO_PUBLIC_ENV: 'production' },
            version: '1.0.0',
          },
        },
      }));
      logger = getLogger();
    });

    it('info() does NOT call console.info in production', () => {
      logger.info('should be silent');
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('debug() does NOT call console.debug in production', () => {
      logger.debug('should be silent');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });
  });
});
