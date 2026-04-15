import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import {
  DrawerContentScrollView,
  DrawerItem,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer'
import { useAuth } from '../context/AuthContext'
import { colors, fontSize, spacing } from '../theme/colors'

export function DrawerContent(props: DrawerContentComponentProps) {
  const { session } = useAuth()

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.appName}>Pegasus</Text>
        {session?.email ? (
          <Text style={styles.userEmail} numberOfLines={1}>
            {session.email}
          </Text>
        ) : null}
      </View>

      <View style={styles.items}>
        <DrawerItem
          label="Paperwork"
          labelStyle={styles.itemLabel}
          onPress={() => props.navigation.navigate('paperwork')}
        />
      </View>
    </DrawerContentScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  appName: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  userEmail: {
    marginTop: spacing.xs,
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  items: {
    flex: 1,
  },
  itemLabel: {
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.textPrimary,
  },
})
