import React, { useEffect, useState } from 'react'
import { Modal, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../theme/colors'
import { getPermission } from '../services/permissions'
import { enableNotifications } from '../services/pushNotifications'
import { storage } from '../utils/storage'
import { logger } from '../utils/logger'
import { PermissionPrompt } from './PermissionPrompt'
import { BANNER_SNOOZE_MS, SNOOZE_KEY } from './PermissionBanner'

/** Set once the primer has been shown on this device — it never shows twice. */
export const PUSH_PRIMER_KEY = 'pegasus_push_primer_shown'

/**
 * The soft ask before the OS notification prompt.
 *
 * iOS shows its prompt exactly once and Android 13+ twice, so the OS dialog is
 * never fired cold: the driver first sees WHY (trip assignments, chat, blocked
 * tasks), and only "Turn on notifications" calls the OS prompt. "Not now"
 * leaves the OS prompt unspent; the dashboard banner picks it up from there.
 *
 * Shown once per device, only while the OS can still prompt. A Modal rather
 * than a route, so it doesn't depend on the navigator being ready at login.
 */
export function PushPrimer({ enabled, accountKey }: { enabled: boolean; accountKey: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!enabled || !accountKey) return
    let active = true
    ;(async () => {
      try {
        if (await storage.getItem(PUSH_PRIMER_KEY)) return
        if ((await getPermission('notifications')) !== 'askable') return
        if (active) setVisible(true)
      } catch (error) {
        logger.warn('Push primer check failed', error)
      }
    })()
    return () => {
      active = false
    }
  }, [enabled, accountKey])

  const done = () => {
    setVisible(false)
    void storage.setItem(PUSH_PRIMER_KEY, new Date().toISOString()).catch(() => undefined)
  }

  // "Not now" must not be answered by the dashboard banner a second later, so
  // it starts the banner's snooze too.
  const notNow = () => {
    done()
    void storage.setItem(SNOOZE_KEY, String(Date.now() + BANNER_SNOOZE_MS)).catch(() => undefined)
  }

  const turnOn = async () => {
    done()
    await enableNotifications(accountKey)
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={notNow}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <PermissionPrompt
          kind="notifications"
          state="askable"
          title="Stay in the loop"
          body="Dispatch reaches you through notifications: new trip assignments, chat messages, and alerts when a task is blocked. Turn them on so you don’t miss one."
          askLabel="Turn on notifications"
          onFix={() => void turnOn()}
          secondary={{ label: 'Not now', onPress: notNow }}
        />
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight, justifyContent: 'center' },
})
