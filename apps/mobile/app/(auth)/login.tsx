import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useAuth } from '../../src/context/AuthContext'
import { AuthError } from '../../src/auth/types'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors'
import { authService } from '../_layout'

type LoginStep = 'email' | 'password'

export default function LoginScreen() {
  const params = useLocalSearchParams<{
    step?: string
    tenantId?: string
    tenantName?: string
    email?: string
  }>()

  // D-08: if picker handed off step=password params, initialise directly in password step
  const initialStep: LoginStep = params.step === 'password' ? 'password' : 'email'
  const initialEmail = params.email ?? ''
  const initialTenantId = params.tenantId ?? ''
  const initialTenantName = params.tenantName ?? ''

  const [step, setStep] = useState<LoginStep>(initialStep)
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [tenantId, setTenantId] = useState(initialTenantId)
  const [tenantName, setTenantName] = useState(initialTenantName)
  const [isLoading, setIsLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const { login } = useAuth()
  const router = useRouter()

  // Email step: resolve tenants
  const handleEmailSubmit = async () => {
    if (!email.trim()) return

    setIsLoading(true)
    setEmailError(null)

    try {
      const tenants = await authService.resolveTenants(email.trim())

      if (tenants.length === 0) {
        // TENANT-04: inline error, no navigation
        setEmailError('Email not registered with Pegasus')
        setIsLoading(false)
        return
      }

      if (tenants.length === 1) {
        // TENANT-02: auto-select, no picker
        const tenant = tenants[0]
        await authService.selectTenant(email.trim(), tenant.tenantId)
        setTenantId(tenant.tenantId)
        setTenantName(tenant.tenantName)
        setStep('password')
        setIsLoading(false)
        return
      }

      // TENANT-03: multiple tenants — navigate to picker
      setIsLoading(false)
      router.push({
        pathname: '/(auth)/tenant-picker',
        params: {
          email: email.trim(),
          tenantsJson: JSON.stringify(tenants),
        },
      })
    } catch {
      setEmailError('Unable to look up account. Please try again.')
      setIsLoading(false)
    }
  }

  // Password step: authenticate
  const handleLogin = async () => {
    if (!password) {
      setPasswordError('Please enter your password.')
      return
    }
    setPasswordError(null)
    setIsLoading(true)
    try {
      await login(email, password, tenantId)
      // navigation handled by Stack.Protected — no router.replace needed here
    } catch (error) {
      const code = error instanceof AuthError ? error.code : 'unknown'
      const messages: Record<string, string> = {
        NotAuthorizedException: 'Incorrect password. Please try again.',
        UserNotFoundException: 'Account not found.',
        UserNotConfirmedException: 'Account not confirmed. Contact your company admin.',
        LimitExceededException: 'Too many attempts. Please wait and try again.',
      }
      setPasswordError(messages[code] ?? 'Unable to connect. Check your internet and try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (step === 'password') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Moving & Storage</Text>
            <Text style={styles.subtitle}>Driver Portal</Text>
          </View>

          <View style={styles.form}>
            {/* TENANT-05: company name above password input */}
            <View style={styles.companyNameContainer}>
              <Text style={styles.companyName}>{tenantName}</Text>
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, styles.inputFlex]}
                  placeholder="Enter password"
                  placeholderTextColor={colors.textDisabled}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text)
                    if (passwordError) setPasswordError(null)
                  }}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  editable={!isLoading}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((prev) => !prev)}
                  style={styles.toggleButton}
                  activeOpacity={0.8}
                >
                  <Text style={styles.toggleText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
                </TouchableOpacity>
              </View>
              {passwordError && <Text style={styles.errorText}>{passwordError}</Text>}
            </View>

            <TouchableOpacity
              style={[styles.button, isLoading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>{isLoading ? 'LOGGING IN...' : 'LOG IN'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    )
  }

  // Email step (default)
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Moving & Storage</Text>
          <Text style={styles.subtitle}>Driver Portal</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="driver@company.com"
              placeholderTextColor={colors.textDisabled}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              editable={!isLoading}
            />
            {/* TENANT-04: inline error below email input */}
            {emailError && <Text style={styles.errorText}>{emailError}</Text>}
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleEmailSubmit}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {isLoading ? 'FINDING COMPANY...' : 'FIND MY COMPANY'}
            </Text>
          </TouchableOpacity>
        </View>
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
    justifyContent: 'center',
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
    fontSize: fontSize.xlarge,
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textLight,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    fontSize: fontSize.large,
    color: colors.textPrimary,
    borderWidth: 2,
    borderColor: colors.border,
    minHeight: touchTarget.minHeight,
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.medium,
    marginTop: spacing.sm,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    borderWidth: 2,
    borderColor: colors.border,
    minHeight: touchTarget.minHeight,
  },
  inputFlex: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  toggleButton: {
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  toggleText: {
    fontSize: fontSize.medium,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  companyNameContainer: {
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  companyName: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.primary,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.lg,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: colors.textDisabled,
  },
  buttonText: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
  },
})
