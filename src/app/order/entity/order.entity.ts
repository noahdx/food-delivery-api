import { OrderStatus, PaymentMethod } from '../types';

export class OrderEntity {
  id: number;
  publicId: string;
  restaurantId: number;
  branchId: number;
  customerId: number;
  customerAddressId: number;
  deliveryLat: number;
  deliveryLng: number;
  deliveryAddressTextSnapshot: string;
  status: OrderStatus;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  agentId?: number | null;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt?: Date | null;
  rejectedAt?: Date | null;
  readyAt?: Date | null;
  assignedAt?: Date | null;
  pickedAt?: Date | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;

  constructor(data: Partial<OrderEntity>) {
    this.id = data.id!;
    this.publicId = data.publicId!;
    this.restaurantId = data.restaurantId!;
    this.branchId = data.branchId!;
    this.customerId = data.customerId!;
    this.customerAddressId = data.customerAddressId!;
    this.deliveryLat = Number(data.deliveryLat);
    this.deliveryLng = Number(data.deliveryLng);
    this.deliveryAddressTextSnapshot = data.deliveryAddressTextSnapshot!;
    this.status = data.status!;
    this.subtotal = data.subtotal!;
    this.deliveryFee = data.deliveryFee!;
    this.serviceFee = data.serviceFee!;
    this.total = data.total!;
    this.paymentMethod = data.paymentMethod!;
    this.agentId = data.agentId ?? null;
    this.createdAt = data.createdAt ?? new Date();
    this.updatedAt = data.updatedAt ?? new Date();
    this.acceptedAt = data.acceptedAt ?? null;
    this.rejectedAt = data.rejectedAt ?? null;
    this.readyAt = data.readyAt ?? null;
    this.assignedAt = data.assignedAt ?? null;
    this.pickedAt = data.pickedAt ?? null;
    this.deliveredAt = data.deliveredAt ?? null;
    this.cancelledAt = data.cancelledAt ?? null;
  }
}
