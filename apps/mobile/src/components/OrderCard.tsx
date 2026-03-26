import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { type TruckingOrder } from '../types'
import { StatusBadge } from './StatusBadge'
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../theme/colors'

interface OrderCardProps {
  order: TruckingOrder
  onPress: () => void
}

export const OrderCard: React.FC<OrderCardProps> = ({ order, onPress }) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.orderNumber}>{order.orderNumber}</Text>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>CUSTOMER</Text>
        <Text style={styles.value}>{order.customer.name}</Text>
        <Text style={styles.phone}>{order.customer.phone}</Text>
      </View>

      <View style={styles.locationContainer}>
        <View style={styles.location}>
          <Text style={styles.locationLabel}>PICKUP</Text>
          <Text style={styles.locationText} numberOfLines={1}>
            {order.pickup.city}, {order.pickup.state}
          </Text>
          <Text style={styles.dateText}>{formatDate(order.pickup.scheduledDate)}</Text>
        </View>

        <View style={styles.arrow}>
          <Text style={styles.arrowText}>→</Text>
        </View>

        <View style={styles.location}>
          <Text style={styles.locationLabel}>DROPOFF</Text>
          <Text style={styles.locationText} numberOfLines={1}>
            {order.dropoff.city}, {order.dropoff.state}
          </Text>
          <Text style={styles.dateText}>{formatDate(order.dropoff.scheduledDate)}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.itemCount}>
          {order.inventory.length} item{order.inventory.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    minHeight: touchTarget.minHeight,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  orderNumber: {
    fontSize: fontSize.xxlarge,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  section: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  value: {
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  phone: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    backgroundColor: colors.backgroundLight,
    padding: spacing.md,
    borderRadius: borderRadius.medium,
  },
  location: {
    flex: 1,
  },
  locationLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  locationText: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  dateText: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  arrow: {
    paddingHorizontal: spacing.sm,
  },
  arrowText: {
    fontSize: fontSize.xxlarge,
    color: colors.primary,
    fontWeight: '700',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  itemCount: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    fontWeight: '600',
  },
})
