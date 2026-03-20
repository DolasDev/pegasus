import Constants from 'expo-constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogTransport {
  log: (level: LogLevel, message: string, data?: any) => void;
}

class ConsoleTransport implements LogTransport {
  log(level: LogLevel, message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    switch (level) {
      case 'debug':
        console.debug(logMessage, data || '');
        break;
      case 'info':
        console.info(logMessage, data || '');
        break;
      case 'warn':
        console.warn(logMessage, data || '');
        break;
      case 'error':
        console.error(logMessage, data || '');
        break;
    }
  }
}

class MockTransport implements LogTransport {
  log(_level: LogLevel, _message: string, _data?: any) {
    // Silent in production - ready for Sentry or other remote logging
  }
}

class Logger {
  private transport: LogTransport;
  private isProduction: boolean;

  constructor() {
    const env = Constants.expoConfig?.extra?.EXPO_PUBLIC_ENV || 'development';
    this.isProduction = env === 'production';
    this.transport = this.isProduction ? new MockTransport() : new ConsoleTransport();
  }

  debug(message: string, data?: any) {
    if (!this.isProduction) {
      this.transport.log('debug', message, data);
    }
  }

  info(message: string, data?: any) {
    this.transport.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.transport.log('warn', message, data);
  }

  error(message: string, data?: any) {
    this.transport.log('error', message, data);
  }

  // Breadcrumb helpers for common events
  logAuth(action: 'login' | 'logout', email?: string) {
    this.info(`Auth: ${action}`, { email });
  }

  logOrderStatusChange(orderId: string, fromStatus: string, toStatus: string) {
    this.info(`Order status changed: ${orderId}`, {
      from: fromStatus,
      to: toStatus,
    });
  }

  logCameraCapture(orderId: string, photoCount: number) {
    this.info(`Camera: Photo captured for order ${orderId}`, {
      totalPhotos: photoCount,
    });
  }

  logOrderLoad(count: number) {
    this.debug(`Orders loaded`, { count });
  }

  logNavigation(screen: string) {
    this.debug(`Navigation: ${screen}`);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export types for testing
export type { LogLevel, LogTransport };
