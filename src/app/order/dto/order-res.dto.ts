import { OrderEntity } from '../entity/order.entity';
import { OrderItemEntity } from '../entity/order-item.entity';

export class OrderResponseDTO {
  static from(order: OrderEntity, items: OrderItemEntity[], payment?: { sessionId: string; redirectUrl: string }) {
    return {
      id: order.id,
      publicId: order.publicId,
      restaurantId: order.restaurantId,
      branchId: order.branchId,
      customerId: order.customerId,
      customerAddressId: order.customerAddressId,
      deliveryCoordinates: {
        lat: order.deliveryLat,
        lng: order.deliveryLng,
      },
      deliveryAddress: order.deliveryAddressTextSnapshot,
      status: order.status,
      money: {
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        serviceFee: order.serviceFee,
        total: order.total,
      },
      paymentMethod: order.paymentMethod,
      agentId: order.agentId,
      timestamps: {
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        acceptedAt: order.acceptedAt,
        rejectedAt: order.rejectedAt,
        readyAt: order.readyAt,
        assignedAt: order.assignedAt,
        pickedAt: order.pickedAt,
        deliveredAt: order.deliveredAt,
        cancelledAt: order.cancelledAt,
      },
      items: items.map((i) => ({
        id: i.id,
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPriceSnapshot,
        name: i.nameSnapshot,
        imageUrl: i.imageUrlSnapshot,
        lineTotal: i.lineTotal,
      })),
      ...(payment ? { payment } : {}),
    };
  }
}
