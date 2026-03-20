export interface TruckingOrder {
  orderId: string;
  orderNumber: string;

  pickup: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
    scheduledDate: string;
    actualDate?: string;
  };

  dropoff: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
    scheduledDate: string;
    actualDate?: string;
  };

  inventory: InventoryItem[];

  customer: {
    name: string;
    phone: string;
    email: string;
    notes?: string;
  };

  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled';

  proofOfDelivery?: {
    photos: string[];
    signature?: string;
    deliveredAt: string;
    notes?: string;
  };

  assignedDriverId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  description: string;
  quantity: number;
  weight?: number;
  fragile: boolean;
  notes?: string;
}

export interface Driver {
  id: string;
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  truckId?: string;
}

export type OrderStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled';
