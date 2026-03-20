import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }

    if (password.length < 4) {
      Alert.alert('Error', 'Password must be at least 4 characters');
      return;
    }

    setIsLoading(true);
    const success = await login(email, password);
    setIsLoading(false);

    if (!success) {
      Alert.alert('Error', 'Login failed. Please try again.');
    }
  };

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
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter password"
              placeholderTextColor={colors.textDisabled}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              editable={!isLoading}
            />
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {isLoading ? 'LOGGING IN...' : 'LOG IN'}
            </Text>
          </TouchableOpacity>

          <View style={styles.hint}>
            <Text style={styles.hintText}>Demo: Use any email and password (4+ chars)</Text>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
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
  hint: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: borderRadius.medium,
  },
  hintText: {
    fontSize: fontSize.small,
    color: colors.textLight,
    textAlign: 'center',
    opacity: 0.7,
  },
});
