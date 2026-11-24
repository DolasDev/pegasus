import { AppState } from 'react-native'
import { renderHook, waitFor, act } from '@testing-library/react-native'
import * as Contacts from 'expo-contacts'
import { usePermission } from './usePermission'

beforeEach(() => jest.clearAllMocks())

describe('usePermission', () => {
  it('reads the state on mount without prompting', async () => {
    const { result } = renderHook(() => usePermission('contacts'))
    await waitFor(() => expect(result.current.state).toBe('granted'))
    expect(Contacts.requestPermissionsAsync).not.toHaveBeenCalled()
  })

  // The driver fixes it in Settings, then comes back: the nudge must update.
  it('re-reads when the app returns to the foreground', async () => {
    let onChange: ((s: string) => void) | undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, handler) => {
      onChange = handler as (s: string) => void
      return { remove: jest.fn() } as never
    })
    ;(Contacts.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    })
    const { result } = renderHook(() => usePermission('contacts'))
    await waitFor(() => expect(result.current.state).toBe('blocked'))

    await act(async () => onChange?.('active'))
    await waitFor(() => expect(result.current.state).toBe('granted'))
  })

  it('reports notApplicable when the OS check throws, rather than nagging', async () => {
    ;(Contacts.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => usePermission('contacts'))
    await waitFor(() => expect(result.current.state).toBe('notApplicable'))
  })
})
