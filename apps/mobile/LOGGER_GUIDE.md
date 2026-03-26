# Logger Utility Guide

## Overview

The app includes a professional logging system (`src/utils/logger.ts`) that provides structured logging with different severity levels and automatic production silencing.

## Features

- **Four Log Levels:** debug, info, warn, error
- **Production Ready:** Logs automatically silenced in production builds
- **Breadcrumb Helpers:** Pre-built methods for common events
- **Type Safe:** Full TypeScript support
- **Sentry Ready:** Easy integration with error tracking services

## Usage

### Import the Logger

```typescript
import { logger } from '../utils/logger'
```

### Basic Logging

```typescript
// Debug - development only
logger.debug('User tapped order card', { orderId: 'ORD-123' })

// Info - important events
logger.info('Order status updated successfully')

// Warn - potential issues
logger.warn('Camera permission denied')

// Error - failures
logger.error('Failed to load orders', error)
```

### Breadcrumb Helpers

Pre-built methods for common app events:

#### Authentication Events

```typescript
// User login
logger.logAuth('login', 'driver@example.com')

// User logout
logger.logAuth('logout', 'driver@example.com')
```

#### Order Events

```typescript
// Status change
logger.logOrderStatusChange('ORD-123', 'pending', 'in_transit')

// Orders loaded
logger.logOrderLoad(4) // 4 orders loaded

// Camera capture
logger.logCameraCapture('ORD-123', 2) // 2 photos total
```

#### Navigation Events

```typescript
logger.logNavigation('Dashboard')
logger.logNavigation('Order Detail: ORD-123')
```

## Log Levels Explained

| Level | When to Use                         | Example                         |
| ----- | ----------------------------------- | ------------------------------- |
| debug | Development debugging, verbose info | Variable values, function calls |
| info  | Important business events           | User actions, state changes     |
| warn  | Recoverable issues                  | Permission denied, retries      |
| error | Failures and exceptions             | API errors, crashes             |

## Production Behavior

In production builds (when `EXPO_PUBLIC_ENV=production`):

- **debug** logs are completely silenced
- **info, warn, error** logs use MockTransport (silent)
- Ready for Sentry/remote logging integration

## Environment Detection

The logger automatically detects the environment:

```typescript
// Development
EXPO_PUBLIC_ENV = development // Logs to console

// Preview
EXPO_PUBLIC_ENV = preview // Logs to console

// Production
EXPO_PUBLIC_ENV = production // Silent (mock transport)
```

## Log Format

Console logs include:

- Timestamp (ISO 8601)
- Log level
- Message
- Optional data object

```
[2025-12-27T10:30:45.123Z] [INFO] Auth: login { email: 'driver@test.com' }
[2025-12-27T10:31:12.456Z] [ERROR] Failed to load orders { code: 'NETWORK_ERROR' }
```

## Integration Points

### Where Logging is Implemented

1. **AuthContext** (`src/context/AuthContext.tsx`)
   - Login events
   - Logout events
   - Session errors

2. **OrderService** (`src/services/orderService.ts`)
   - Order loading
   - Status updates
   - Photo captures
   - Service errors

3. **Future Integrations**
   - Navigation tracking
   - Performance monitoring
   - User interactions
   - API calls

## Adding Logging to New Features

### Component Example

```typescript
import { logger } from '../utils/logger'

function MyComponent() {
  const handleAction = () => {
    logger.info('User performed action', {
      actionType: 'button_click',
      componentName: 'MyComponent',
    })

    try {
      // Do something
    } catch (error) {
      logger.error('Action failed', { error, component: 'MyComponent' })
    }
  }
}
```

### Service Example

```typescript
import { logger } from '../utils/logger'

export class MyService {
  static async doSomething() {
    logger.debug('Starting operation', { service: 'MyService' })

    try {
      const result = await operation()
      logger.info('Operation completed', { result })
      return result
    } catch (error) {
      logger.error('Operation failed', error)
      throw error
    }
  }
}
```

## Custom Breadcrumb Methods

Add new breadcrumb helpers to `logger.ts`:

```typescript
class Logger {
  // ... existing methods

  logPaymentProcessed(orderId: string, amount: number) {
    this.info(`Payment processed for order ${orderId}`, {
      amount,
      currency: 'USD',
    })
  }

  logRouteOptimized(orderCount: number, duration: number) {
    this.info(`Route optimized`, {
      orders: orderCount,
      estimatedDuration: duration,
    })
  }
}
```

## Integrating with Sentry

Replace MockTransport with Sentry:

```typescript
import * as Sentry from '@sentry/react-native';

class SentryTransport implements LogTransport {
  log(level: LogLevel, message: string, data?: any) {
    const breadcrumb = {
      message,
      level,
      data,
    };

    Sentry.addBreadcrumb(breadcrumb);

    if (level === 'error') {
      Sentry.captureException(new Error(message), {
        extra: data,
      });
    }
  }
}

// Update Logger constructor
constructor() {
  this.transport = this.isProduction
    ? new SentryTransport()
    : new ConsoleTransport();
}
```

## Performance Considerations

- Logging is synchronous (console.log is fast)
- Debug logs are free in production (completely disabled)
- Data objects are shallow-logged (avoid deep nesting)
- No persistent storage (in-memory only)

## Best Practices

1. **Be Descriptive**

   ```typescript
   // Good
   logger.info('Order ORD-123 status changed to delivered', {
     orderId: 'ORD-123',
     newStatus: 'delivered',
   })

   // Bad
   logger.info('Updated')
   ```

2. **Include Context**

   ```typescript
   logger.error('Failed to save order', {
     orderId,
     error: error.message,
     retryCount: 3,
   })
   ```

3. **Use Appropriate Levels**
   - Don't use error for warnings
   - Don't use info for debug information
   - Reserve error for actual failures

4. **Avoid Sensitive Data**

   ```typescript
   // Good
   logger.logAuth('login', email)

   // Bad
   logger.logAuth('login', { email, password }) // Never log passwords!
   ```

5. **Structure Data Consistently**
   ```typescript
   logger.info('Event name', {
     entityId: 'ID',
     entityType: 'TYPE',
     action: 'ACTION',
     metadata: {},
   })
   ```

## Troubleshooting

### Logs Not Appearing

1. Check environment variable:

   ```javascript
   import Constants from 'expo-constants'
   console.log(Constants.expoConfig?.extra?.EXPO_PUBLIC_ENV)
   ```

2. Verify production mode isn't enabled

3. Check console filtering in dev tools

### Too Many Logs

1. Use debug level for verbose logs
2. Filter by log level in console
3. Reduce data object size

---

**Location:** `src/utils/logger.ts`
**Last Updated:** December 2025
**Production Ready:** Yes (silent mode)
**Sentry Ready:** Yes (requires integration)
