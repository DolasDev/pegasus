import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ChatThreadView } from '../../src/components/chat/ChatThreadView'
import { useChat } from '../../src/chat/ChatContext'
import { searchedOrderNum } from '../../src/chat/inbox'
import { displayShipper, routeLine } from '../../src/chat/format'
import { colors, fontSize, spacing } from '../../src/theme/colors'

// A move's conversation, full screen — opened from the Messages list. Pushed
// on the ROOT stack (declared in app/_layout.tsx) so iOS draws its back
// chevron; see the detailHeader comment there.

export default function ChatScreen() {
  const params = useLocalSearchParams<{ orderNum: string }>()
  const orderNum = searchedOrderNum(params.orderNum ?? '')
  const { summaries, ensureSummaries } = useChat()

  useEffect(() => {
    if (orderNum != null) ensureSummaries([orderNum])
  }, [orderNum, ensureSummaries])

  if (orderNum == null) {
    return (
      <SafeAreaView style={styles.centered} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Chat' }} />
        <Text style={styles.text}>That isn’t an order number.</Text>
      </SafeAreaView>
    )
  }

  const summary = summaries[orderNum]
  const shipper = displayShipper(summary?.shipperName)
  const route = routeLine(summary)

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: shipper ? `#${orderNum} · ${shipper}` : `#${orderNum}` }} />
      {route ? (
        <View style={styles.subheader}>
          <Text style={styles.route} numberOfLines={1}>
            {route}
          </Text>
        </View>
      ) : null}
      <ChatThreadView key={orderNum} orderNum={orderNum} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.backgroundLight },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backgroundLight,
  },
  text: { fontSize: fontSize.large, color: colors.textSecondary },
  subheader: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  route: { fontSize: fontSize.medium, color: colors.textSecondary },
})
