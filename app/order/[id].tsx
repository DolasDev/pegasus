import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { TruckingOrder, OrderStatus } from '../../src/types';
import { OrderService } from '../../src/services/orderService';
import { StatusBadge } from '../../src/components/StatusBadge';
import { colors, fontSize, spacing, borderRadius, touchTarget } from '../../src/theme/colors';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<TruckingOrder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);

  useEffect(() => {
    loadOrder();
  }, [id]);

  const loadOrder = async () => {
    if (!id) return;
    setIsLoading(true);
    const data = await OrderService.getOrderById(id as string);
    setOrder(data);
    if (data?.proofOfDelivery?.photos) {
      setCapturedPhotos(data.proofOfDelivery.photos);
    }
    setIsLoading(false);
  };

  const handleStatusUpdate = async (newStatus: OrderStatus) => {
    if (!order) return;

    const statusMap = {
      pending: 'Pending',
      in_transit: 'In Transit',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };

    if (newStatus === 'delivered' && capturedPhotos.length === 0) {
      Alert.alert(
        'Proof of Delivery Required',
        'Please capture at least one photo before marking as delivered.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Update Status',
      `Change status to ${statusMap[newStatus]}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setIsUpdating(true);
            const success = await OrderService.updateOrderStatus(
              order.orderId,
              newStatus,
              newStatus === 'delivered' ? capturedPhotos : undefined
            );
            setIsUpdating(false);

            if (success) {
              Alert.alert('Success', `Order status updated to ${statusMap[newStatus]}`);
              await loadOrder();
            } else {
              Alert.alert('Error', 'Failed to update order status');
            }
          },
        },
      ]
    );
  };

  const handleCapturePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status !== 'granted') {
      Alert.alert(
        'Camera Permission Required',
        'Please enable camera permissions in your device settings to capture proof of delivery photos.',
        [{ text: 'OK' }]
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const photoUri = result.assets[0].uri;
      setCapturedPhotos([...capturedPhotos, photoUri]);

      if (order) {
        await OrderService.addProofPhoto(order.orderId, photoUri);
        Alert.alert('Success', 'Photo added to proof of delivery');
      }
    }
  };

  const getNextStatus = (): OrderStatus | null => {
    if (!order) return null;
    switch (order.status) {
      case 'pending':
        return 'in_transit';
      case 'in_transit':
        return 'delivered';
      default:
        return null;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Order not found</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.back()}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const nextStatus = getNextStatus();

  return (
    <>
      <Stack.Screen
        options={{
          title: order.orderNumber,
          headerStyle: { backgroundColor: colors.backgroundDark },
          headerTintColor: colors.textLight,
          headerTitleStyle: { fontWeight: '700', fontSize: fontSize.xlarge },
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.orderNumber}>{order.orderNumber}</Text>
          <StatusBadge status={order.status} size="large" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CUSTOMER</Text>
          <View style={styles.card}>
            <Text style={styles.customerName}>{order.customer.name}</Text>
            <Text style={styles.customerInfo}>{order.customer.phone}</Text>
            <Text style={styles.customerInfo}>{order.customer.email}</Text>
            {order.customer.notes && (
              <View style={styles.notesContainer}>
                <Text style={styles.notesLabel}>Notes:</Text>
                <Text style={styles.notesText}>{order.customer.notes}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PICKUP LOCATION</Text>
          <View style={styles.card}>
            <Text style={styles.address}>{order.pickup.address}</Text>
            <Text style={styles.cityState}>
              {order.pickup.city}, {order.pickup.state} {order.pickup.zipCode}
            </Text>
            <Text style={styles.date}>Scheduled: {formatDate(order.pickup.scheduledDate)}</Text>
            {order.pickup.actualDate && (
              <Text style={styles.actualDate}>
                Actual: {formatDate(order.pickup.actualDate)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DROPOFF LOCATION</Text>
          <View style={styles.card}>
            <Text style={styles.address}>{order.dropoff.address}</Text>
            <Text style={styles.cityState}>
              {order.dropoff.city}, {order.dropoff.state} {order.dropoff.zipCode}
            </Text>
            <Text style={styles.date}>Scheduled: {formatDate(order.dropoff.scheduledDate)}</Text>
            {order.dropoff.actualDate && (
              <Text style={styles.actualDate}>
                Actual: {formatDate(order.dropoff.actualDate)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            INVENTORY ({order.inventory.length} ITEMS)
          </Text>
          {order.inventory.map((item, index) => (
            <View key={item.id} style={styles.inventoryCard}>
              <View style={styles.inventoryHeader}>
                <Text style={styles.inventoryDescription}>{item.description}</Text>
                {item.fragile && (
                  <View style={styles.fragileTag}>
                    <Text style={styles.fragileText}>FRAGILE</Text>
                  </View>
                )}
              </View>
              <View style={styles.inventoryDetails}>
                <Text style={styles.inventoryDetail}>Qty: {item.quantity}</Text>
                {item.weight && (
                  <Text style={styles.inventoryDetail}>Weight: {item.weight} lbs</Text>
                )}
              </View>
              {item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PROOF OF DELIVERY</Text>
          <View style={styles.card}>
            {capturedPhotos.length > 0 ? (
              <View style={styles.photosContainer}>
                {capturedPhotos.map((uri, index) => (
                  <Image key={index} source={{ uri }} style={styles.photo} />
                ))}
              </View>
            ) : (
              <Text style={styles.noPhotos}>No photos captured yet</Text>
            )}
            <TouchableOpacity
              style={styles.cameraButton}
              onPress={handleCapturePhoto}
              activeOpacity={0.8}
            >
              <Text style={styles.cameraButtonText}>CAPTURE PHOTO</Text>
            </TouchableOpacity>
          </View>
        </View>

        {nextStatus && (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.statusButton, isUpdating && styles.statusButtonDisabled]}
              onPress={() => handleStatusUpdate(nextStatus)}
              disabled={isUpdating}
              activeOpacity={0.8}
            >
              <Text style={styles.statusButtonText}>
                {isUpdating
                  ? 'UPDATING...'
                  : nextStatus === 'in_transit'
                  ? 'START DELIVERY'
                  : 'MARK AS DELIVERED'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundLight,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  orderNumber: {
    fontSize: fontSize.huge,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.medium,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.md,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.large,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
  },
  customerName: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  customerInfo: {
    fontSize: fontSize.large,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  notesContainer: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.backgroundLight,
    borderRadius: borderRadius.small,
  },
  notesLabel: {
    fontSize: fontSize.medium,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  notesText: {
    fontSize: fontSize.medium,
    color: colors.textPrimary,
  },
  address: {
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cityState: {
    fontSize: fontSize.large,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  date: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
  },
  actualDate: {
    fontSize: fontSize.medium,
    color: colors.success,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  inventoryCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.medium,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: colors.border,
  },
  inventoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  inventoryDescription: {
    flex: 1,
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  fragileTag: {
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.small,
    marginLeft: spacing.sm,
  },
  fragileText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  inventoryDetails: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  inventoryDetail: {
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  itemNotes: {
    marginTop: spacing.sm,
    fontSize: fontSize.medium,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  photosContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: borderRadius.small,
    backgroundColor: colors.backgroundLight,
  },
  noPhotos: {
    fontSize: fontSize.large,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  cameraButton: {
    backgroundColor: colors.info,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  cameraButtonText: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
  },
  statusButton: {
    backgroundColor: colors.success,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    alignItems: 'center',
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
  },
  statusButtonDisabled: {
    backgroundColor: colors.textDisabled,
  },
  statusButtonText: {
    fontSize: fontSize.xlarge,
    fontWeight: '700',
    color: colors.textLight,
    letterSpacing: 1,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.medium,
    padding: spacing.lg,
    marginTop: spacing.lg,
    minHeight: touchTarget.minHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonText: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.textLight,
    textAlign: 'center',
  },
  errorText: {
    fontSize: fontSize.xlarge,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
});
