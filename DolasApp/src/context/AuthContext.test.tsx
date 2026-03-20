import React from 'react';
import { render, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider, useAuth } from './AuthContext';
import { logger } from '../utils/logger';

// Updates ctxRef.current on every render so tests always see the latest state.
function TestConsumer({
  ctxRef,
}: {
  ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null>;
}) {
  ctxRef.current = useAuth();
  return null;
}

// Render synchronously — never inside act(), which unmounts the renderer.
// Call `await act(async () => {})` after this to flush async effects (checkSession).
function renderWithProvider(): React.MutableRefObject<ReturnType<typeof useAuth> | null> {
  const ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null> = { current: null };
  render(
    <AuthProvider>
      <TestConsumer ctxRef={ctxRef} />
    </AuthProvider>
  );
  return ctxRef;
}

describe('AuthProvider', () => {
  describe('initial state', () => {
    it('has isAuthenticated false and isLoading false after session check with no stored session', async () => {
      const ctxRef = renderWithProvider();
      await act(async () => {});
      expect(ctxRef.current!.isAuthenticated).toBe(false);
      expect(ctxRef.current!.isLoading).toBe(false);
    });
  });

  describe('checkSession', () => {
    it('restores auth state from AsyncStorage when session exists', async () => {
      const session = JSON.stringify({ email: 'test@example.com', name: 'Test User' });
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(session);

      const ctxRef = renderWithProvider();
      await act(async () => {});

      expect(ctxRef.current!.isAuthenticated).toBe(true);
      expect(ctxRef.current!.driverEmail).toBe('test@example.com');
      expect(ctxRef.current!.driverName).toBe('Test User');
      expect(ctxRef.current!.isLoading).toBe(false);
    });

    it('leaves isAuthenticated false when no session in storage', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

      const ctxRef = renderWithProvider();
      await act(async () => {});

      expect(ctxRef.current!.isAuthenticated).toBe(false);
      expect(ctxRef.current!.isLoading).toBe(false);
    });
  });

  describe('login', () => {
    let ctxRef: React.MutableRefObject<ReturnType<typeof useAuth> | null>;

    beforeEach(async () => {
      ctxRef = renderWithProvider();
      await act(async () => {});
    });

    it('returns true, persists session, and updates state on success', async () => {
      let result = false;
      await act(async () => {
        result = await ctxRef.current!.login('driver@example.com', 'pass1');
      });

      expect(result).toBe(true);
      expect(ctxRef.current!.isAuthenticated).toBe(true);
      expect(ctxRef.current!.driverEmail).toBe('driver@example.com');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@moving_app_session',
        expect.stringContaining('driver@example.com')
      );
      expect(logger.logAuth).toHaveBeenCalledWith('login', 'driver@example.com');
    });

    it('returns false when email is empty', async () => {
      let result = true;
      await act(async () => {
        result = await ctxRef.current!.login('', 'pass1');
      });

      expect(result).toBe(false);
      expect(ctxRef.current!.isAuthenticated).toBe(false);
    });

    it('returns false when password is shorter than 4 characters', async () => {
      let result = true;
      await act(async () => {
        result = await ctxRef.current!.login('driver@example.com', 'abc');
      });

      expect(result).toBe(false);
      expect(ctxRef.current!.isAuthenticated).toBe(false);
    });

    it('returns false when AsyncStorage.setItem throws', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Storage full'));

      let result = true;
      await act(async () => {
        result = await ctxRef.current!.login('driver@example.com', 'pass1');
      });

      expect(result).toBe(false);
    });
  });

  describe('logout', () => {
    it('removes session from AsyncStorage, resets state, and calls logAuth', async () => {
      const session = JSON.stringify({ email: 'driver@example.com', name: 'Driver' });
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(session);

      const ctxRef = renderWithProvider();
      await act(async () => {});

      expect(ctxRef.current!.isAuthenticated).toBe(true);

      await act(async () => {
        await ctxRef.current!.logout();
      });

      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@moving_app_session');
      expect(ctxRef.current!.isAuthenticated).toBe(false);
      expect(ctxRef.current!.driverEmail).toBe('');
      expect(ctxRef.current!.driverName).toBe('');
      expect(logger.logAuth).toHaveBeenCalledWith('logout', 'driver@example.com');
    });
  });
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    function BareConsumer() {
      useAuth();
      return null;
    }
    expect(() => render(<BareConsumer />)).toThrow(
      'useAuth must be used within an AuthProvider'
    );
    spy.mockRestore();
  });
});
