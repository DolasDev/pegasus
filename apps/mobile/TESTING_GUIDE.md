# Testing Guide - Moving & Storage Driver App

## Overview

This app includes a comprehensive Jest testing suite with unit tests, component tests, and snapshot tests to ensure code quality and prevent UI regressions.

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Specific Test File

```bash
npm test -- OrderCard.test
```

## Test Structure

### Unit Tests

**Location:** `src/services/orderService.test.ts`

Tests the business logic for order management:

- ✓ Loading orders from storage
- ✓ Status update workflow enforcement
- ✓ Prevents invalid status transitions
- ✓ Photo proof of delivery handling
- ✓ Pickup/dropoff date tracking

**Key Test: Status Workflow**

```typescript
it('should successfully update order from pending to in_transit', async () => {
  // Ensures proper status progression
})

it('should successfully update order from in_transit to delivered', async () => {
  // Validates delivery workflow
})
```

### Component Tests

**Location:** `src/components/OrderCard.test.tsx`

Tests the OrderCard component rendering:

- ✓ Displays correct order number
- ✓ Shows customer information
- ✓ Renders correct status badge color
- ✓ Displays pickup/dropoff locations
- ✓ Shows item count (singular/plural)

**Status Badge Tests:**

- Pending: Yellow badge
- In Transit: Blue badge
- Delivered: Green badge

### Snapshot Tests

**Location:** `src/components/__tests__/Dashboard.snapshot.test.tsx`

Prevents UI regressions in the Dashboard (Trucker Mode):

- ✓ Loading state snapshot
- ✓ Empty state snapshot
- ✓ Orders loaded snapshot
- ✓ Mixed status orders snapshot

**What Snapshots Capture:**

- High contrast colors
- Large fonts (18pt+)
- Touch target sizes (48px+)
- Status badge colors
- Layout structure

## Test Coverage Goals

| Component  | Target Coverage |
| ---------- | --------------- |
| Services   | 90%+            |
| Components | 85%+            |
| Utils      | 80%+            |
| Overall    | 75%+            |

## Mocking Strategy

### Global Mocks (jest.setup.js)

- AsyncStorage
- expo-constants
- Logger utility

### Test-Specific Mocks

- expo-router (navigation)
- OrderService (data layer)
- expo-image-picker (camera)

## Writing New Tests

### Component Test Template

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import YourComponent from './YourComponent';

describe('YourComponent', () => {
  it('should render correctly', () => {
    const { getByText } = render(<YourComponent />);
    expect(getByText('Expected Text')).toBeTruthy();
  });
});
```

### Service Test Template

```typescript
import { YourService } from './yourService'

jest.mock('@react-native-async-storage/async-storage')

describe('YourService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should perform expected action', async () => {
    const result = await YourService.method()
    expect(result).toBeDefined()
  })
})
```

## CI/CD Integration

Tests run automatically in CI/CD pipeline:

- On pull requests
- Before builds
- On push to main branches

## Troubleshooting

### AsyncStorage Errors

If you see AsyncStorage native module errors:

```bash
# The mock is configured in jest.setup.js
# Ensure jest.setup.js is in setupFilesAfterEnv
```

### Snapshot Failures

Update snapshots when UI intentionally changes:

```bash
npm test -- -u
```

### Transform Errors

Check `jest.config.js` transformIgnorePatterns includes:

- expo packages
- react-native packages
- navigation packages

## Test Utilities

### Custom Matchers

Available from @testing-library/jest-native:

- `toBeVisible()`
- `toHaveTextContent()`
- `toBeDisabled()`
- `toHaveProp()`

### Testing Library Queries

- `getByText()` - Find by text content
- `getByTestId()` - Find by testID prop
- `findByText()` - Async query
- `queryByText()` - Returns null if not found

## Best Practices

1. **Test Behavior, Not Implementation**
   - Test what the user sees
   - Don't test internal state

2. **Use Data-TestID Sparingly**
   - Prefer getByText for user-facing content
   - Use testID for non-text elements

3. **Mock External Dependencies**
   - Always mock network calls
   - Mock navigation
   - Mock native modules

4. **Keep Tests Independent**
   - Each test should run in isolation
   - Use beforeEach for setup
   - Clear mocks between tests

5. **Test Edge Cases**
   - Empty states
   - Error states
   - Loading states
   - Boundary conditions

## Continuous Improvement

- Run tests before committing
- Maintain >75% coverage
- Update snapshots intentionally
- Review test failures carefully
- Add tests for bug fixes

---

**Last Updated:** December 2025
**Test Framework:** Jest 29.7.0
**Testing Library:** @testing-library/react-native 13.3.3
