import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrderStatus } from '../types';
import { colors, fontSize, spacing, borderRadius } from '../theme/colors';

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'small' | 'large';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'small' }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'pending':
        return {
          label: 'PENDING',
          color: colors.pending,
          textColor: colors.textPrimary,
        };
      case 'in_transit':
        return {
          label: 'IN TRANSIT',
          color: colors.inTransit,
          textColor: colors.textLight,
        };
      case 'delivered':
        return {
          label: 'DELIVERED',
          color: colors.delivered,
          textColor: colors.textLight,
        };
      case 'cancelled':
        return {
          label: 'CANCELLED',
          color: colors.cancelled,
          textColor: colors.textLight,
        };
    }
  };

  const config = getStatusConfig();
  const isLarge = size === 'large';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: config.color },
        isLarge && styles.badgeLarge,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: config.textColor },
          isLarge && styles.textLarge,
        ]}
      >
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.small,
    alignSelf: 'flex-start',
  },
  badgeLarge: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.medium,
  },
  text: {
    fontSize: fontSize.small,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  textLarge: {
    fontSize: fontSize.large,
    letterSpacing: 1,
  },
});
