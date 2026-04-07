import React, { useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'
import { authService } from '../_layout'
import { type TenantResolution } from '../../src/auth/types'

export default function TenantPickerScreen() {
  const { email, tenantsJson } = useLocalSearchParams<{
    email: string
    tenantsJson: string
  }>()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tenants: TenantResolution[] = React.useMemo(() => {
    try {
      return JSON.parse(tenantsJson as string) as TenantResolution[]
    } catch {
      return []
    }
  }, [tenantsJson])

  const handleSelectTenant = async (tenant: TenantResolution) => {
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    try {
      await authService.selectTenant(email as string, tenant.tenantId)

      // Determine the next step based on available auth methods
      const hasProviders = tenant.providers.length > 0
      const nextStep = hasProviders ? 'providers' : 'password'

      router.replace({
        pathname: '/(auth)/login',
        params: {
          step: nextStep,
          tenantId: tenant.tenantId,
          tenantName: tenant.tenantName,
          email: email as string,
          ...(hasProviders ? { providersJson: JSON.stringify(tenant.providers) } : {}),
          cognitoAuthEnabled: tenant.cognitoAuthEnabled ? 'true' : 'false',
        },
      })
    } catch {
      setError('Unable to select company. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Select Company</Text>
          <Text style={styles.subtitle}>Multiple accounts found for {email}</Text>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <FlatList
          data={tenants}
          keyExtractor={(item) => item.tenantId}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tenantItem, isLoading && styles.tenantItemDisabled]}
              onPress={() => handleSelectTenant(item)}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.tenantName}>{item.tenantName}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundDark,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
  },
  header: {
    marginBottom: spacing.xxl,
    alignItems: 'center',
  },
  title: {
    fontSize: fontSize.huge,
    fontWeight: '700',
    color: colors.textLight,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.medium,
    color: colors.textDisabled,
    textAlign: 'center',
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.medium,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  tenantItem: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  tenantItemDisabled: {
    backgroundColor: colors.backgroundLight,
    borderColor: colors.textDisabled,
  },
  tenantName: {
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.textPrimary,
  },
})
