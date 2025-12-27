import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors';
import Constants from 'expo-constants';

export default function SettingsScreen() {
  const { driverName, driverEmail, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: logout,
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Account deletion is not available in this demo version. Contact your administrator for account management.',
      [{ text: 'OK' }]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DRIVER PROFILE</Text>
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{driverName}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.profileRow}>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{driverEmail}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>APP INFORMATION</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Version</Text>
            <Text style={styles.infoValue}>
              {Constants.expoConfig?.version || '1.0.0'}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Build</Text>
            <Text style={styles.infoValue}>Preview</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LEGAL</Text>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => Alert.alert('Privacy Policy', 'Privacy policy content would be displayed here.')}
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => Alert.alert('Terms of Service', 'Terms of service content would be displayed here.')}
        >
          <Text style={styles.linkText}>Terms of Service</Text>
          <Text style={styles.arrow}>→</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ACCOUNT ACTIONS</Text>
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={styles.logoutText}>LOG OUT</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteButton}
          onPress={handleDeleteAccount}
          activeOpacity={0.8}
        >
          <Text style={styles.deleteText}>DELETE ACCOUNT</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundLight,
  },
  content: {
    padding: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.md,
    letterSpacing: 1,
  },
  profileCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  profileRow: {
    paddingVertical: spacing.md,
  },
  label: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  value: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  infoCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  infoLabel: {
    fontSize: fontSize.large,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  linkButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    minHeight: touchTarget.minHeight,
    borderWidth: 2,
    borderColor: colors.border,
  },
  linkText: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  arrow: {
    fontSize: fontSize.xlarge,
    color: colors.primary,
    fontWeight: '700',
  },
  logoutButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  logoutText: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
  },
  deleteButton: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.error,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.error,
    letterSpacing: 1,
  },
});
