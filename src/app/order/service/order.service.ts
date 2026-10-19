import { randomUUID } from 'crypto';
import { container, inject, injectable } from 'tsyringe';
import { db } from '../../../lib/knex/knex';
import { tokens } from '../../../lib/di/tokens';
import { UnAuthorizedError } from '../../../lib/auth/errors';
import { IFilterParams, IPaginationParams } from '../../../lib/http/pagination/cursor-pagination';
import { BranchRepository } from '../../branch/repository/branch.repository';
import { RestaurantRepository } from '../../restaurant/repository/restaurant.repository';
import { CustomerAddressRepository } from '../../customer-address/repository/customer-address.repository';
import { ProductBranchDetailsRepository } from '../../product/repository/product-branch-details.repository';
import { ProductEntity } from '../../product/entity/product.entity';
import { ProductService } from '../../product/service/product.service';
import { RestaurantMemberRepository } from '../../rbac/repository/restaurant_member.repository';
import { OrderRepository } from '../repository/order.repository';
import { OrderItemRepository } from '../repository/order-item.repository';
import { CreateOrderDTO, UpdateOrderStatusDTO } from '../dto/order-req.dto';
import { OrderResponseDTO } from '../dto/order-res.dto';
import { OrderEntity } from '../entity/order.entity';
import { OrderItemEntity } from '../entity/order-item.entity';
import { OrderStatus, PaymentMethod, StatusActor } from '../types';
import { validateTransition } from './order-status.service';
import {
  AddressDoesNotBelongToUserError,
  BranchNotAcceptingOrdersError,
  CancelOrderForbiddenError,
  EmptyOrderItemsError,
  OfflineWhilePickedForbiddenError,
  OrderNotFoundError,
  OutOfStockError,
  RestaurantDoesNotMatchError,
} from '../errors';
import { toMinor } from '../../../pkg/utils/money';

const DELIVERY_FEE_MINOR = 1000; // 10.00 minor paid to the delivery agent.
const SERVICE_FEE_MINOR = 1000; // 10.00 minor  paid to the platform.

@injectable()
export class OrderService {
  constructor(
    @inject(tokens.OrderRepository) private readonly orderRepository: OrderRepository,
    @inject(tokens.OrderItemRepository) private readonly orderItemRepository: OrderItemRepository,
    @inject(tokens.BranchRepository) private readonly branchRepository: BranchRepository,
    @inject(tokens.RestaurantRepository) private readonly restaurantRepository: RestaurantRepository,
    @inject(tokens.CustomerAddressRepository) private readonly addressRepository: CustomerAddressRepository,
    @inject(tokens.PBDRepository) private readonly pbdRepository: ProductBranchDetailsRepository,
    @inject(tokens.ProductService) private readonly productService: ProductService,
    @inject(tokens.RestaurantMemberRepository) private readonly memberRepository: RestaurantMemberRepository,
  ) {}

  placeOrder = async (customerId: number, data: CreateOrderDTO) => {
    if (!data.items || data.items.length === 0) {
      throw EmptyOrderItemsError;
    }

    // 1. Validate branch
    const branch = await this.branchRepository.findById(data.branchId);
    if (!branch || !branch.isActive || !branch.acceptOrders) {
      throw BranchNotAcceptingOrdersError;
    }

    // 2. Validate restaurant
    const restaurant = await this.restaurantRepository.findById(branch.restaurantId);
    if (!restaurant || restaurant.status !== 'active') {
      throw BranchNotAcceptingOrdersError;
    }

    // 3. Validate customer address
    const address = await this.addressRepository.findById(data.customerAddressId);
    if (!address || Number(address.userId) !== customerId) {
      throw AddressDoesNotBelongToUserError;
    }
    const addressText = `${address.country}, ${address.city}, ${address.street}, Building ${address.building}, Apt ${address.apartmentNumber}`;

    // 4. Batch query branch product details
    const productIds = data.items.map((i) => Number(i.productId));
    const branchDetails = await this.pbdRepository.findByBranchAndProducts(data.branchId, productIds);
    const detailMap = new Map(branchDetails.map((d) => [Number(d.productId), d]));

    // 5. Query product info for snapshots (name, image) in 1 query via ProductService
    const { data: products } = await this.productService.findByIds(productIds, ['id', 'name', 'img_url']);
    const productMap = new Map(products.map((p) => [Number(p.id), p]));

    // 6. Validate availability, stock, and build drafts
    let subtotal = 0;
    const itemDrafts: Array<{
      productId: number;
      productBranchDetailId: number;
      quantity: number;
      unitPriceSnapshot: number;
      nameSnapshot: string;
      imageUrlSnapshot: string | null;
      lineTotal: number;
    }> = [];

    for (const item of data.items) {
      const pid = Number(item.productId);
      const qty = Number(item.quantity);
      const detail = detailMap.get(pid);
      const product = productMap.get(pid);

      if (!detail || !product || !detail.isAvailable || Number(detail.stock) < qty) {
        throw OutOfStockError;
      }

      const unitPrice = toMinor(Number(detail.price));
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      itemDrafts.push({
        productId: pid,
        productBranchDetailId: Number(detail.id),
        quantity: qty,
        unitPriceSnapshot: unitPrice,
        nameSnapshot: product.name,
        imageUrlSnapshot: product.imgUrl ?? null,
        lineTotal,
      });
    }

    const deliveryFee = DELIVERY_FEE_MINOR;
    const serviceFee = SERVICE_FEE_MINOR;
    const total = subtotal + deliveryFee + serviceFee;
    const publicId = randomUUID();
    const initialStatus = data.paymentMethod === PaymentMethod.ONLINE ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED;

    // 7. Atomic reservation and order insertion
    const trx = await db.transaction();
    let order: OrderEntity;
    let items: OrderItemEntity[];

    try {
      // Decrement stock
      await this.pbdRepository.reserveStock(
        data.branchId,
        data.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        trx,
      );

      // Create order
      order = await this.orderRepository.create(
        {
          publicId,
          restaurantId: branch.restaurantId,
          branchId: data.branchId,
          customerId,
          customerAddressId: data.customerAddressId,
          deliveryLat: address.lat,
          deliveryLng: address.lng,
          deliveryAddressTextSnapshot: addressText,
          status: initialStatus,
          subtotal,
          deliveryFee: DELIVERY_FEE_MINOR,
          serviceFee: SERVICE_FEE_MINOR,
          total,
          paymentMethod: data.paymentMethod,
        },
        trx,
      );

      // Create order items
      items = await this.orderItemRepository.bulkInsert(
        itemDrafts.map((d) => ({
          orderId: order.id,
          productId: d.productId,
          productBranchDetailId: d.productBranchDetailId,
          quantity: d.quantity,
          unitPriceSnapshot: d.unitPriceSnapshot,
          nameSnapshot: d.nameSnapshot,
          imageUrlSnapshot: d.imageUrlSnapshot,
          lineTotal: d.lineTotal,
        })),
        trx,
      );

      await trx.commit();
    } catch (error) {
      await trx.rollback();
      throw error;
    }

    let paymentInfo: { sessionId: string; redirectUrl: string } | undefined = undefined;
    if (data.paymentMethod === PaymentMethod.ONLINE) {
      try {
        const paymentService = container.resolve<any>(tokens.PaymentService);
        const paymentInit = await paymentService.initPayment(
          order.restaurantId,
          order.branchId,
          order.publicId,
          {},
          customerId,
          'customer',
        );
        paymentInfo = {
          sessionId: paymentInit.data.sessionId,
          redirectUrl: paymentInit.data.redirectUrl,
        };
      } catch {
        // Fallback: order remains in pending_payment, customer can init payment later
      }
    }

    return {
      message: 'Order placed successfully',
      data: OrderResponseDTO.from(order, items, paymentInfo),
    };
  };

  getOrderByPublicId = async (publicId: string, userId: number, userRole: string) => {
    const order = await this.orderRepository.findByPublicId(publicId);
    if (!order) {
      throw OrderNotFoundError;
    }

    await this.assertAccess(order, userId, userRole);

    const items = await this.orderItemRepository.findByOrderId(order.id);
    return {
      message: 'Order retrieved successfully',
      data: OrderResponseDTO.from(order, items),
    };
  };

  updateStatus = async (publicId: string, userId: number, userRole: string, data: UpdateOrderStatusDTO) => {
    const order = await this.orderRepository.findByPublicId(publicId);
    if (!order) {
      throw OrderNotFoundError;
    }

    const actor = await this.resolveStatusActor(order, userId, userRole);
    if (actor === StatusActor.RESTAURANT_MEMBER && data.status === OrderStatus.CANCELLED) {
      const memberData = await this.memberRepository.findRestaurantMemberWithRole(userId);
      if (memberData) {
        const permissionCacheService = container.resolve<any>(tokens.PermissionCacheService);
        const permissions = await permissionCacheService.getPermission(memberData.roleName);
        if (!permissionCacheService.hasPermission(permissions, 'core:order', 'cancel')) {
          throw CancelOrderForbiddenError;
        }
      }
    }

    const { stamp } = validateTransition(order.status, data.status, {
      actor,
      reason: data.reason,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt,
    });

    const trx = await db.transaction();
    let updatedOrder: OrderEntity;

    try {
      updatedOrder = await this.orderRepository.updateStatus(publicId, data.status, stamp, trx);

      // If cancelled, release stock back to branch
      if (data.status === OrderStatus.CANCELLED) {
        const items = await this.orderItemRepository.findByOrderId(order.id, trx);
        await this.pbdRepository.releaseStock(
          order.branchId,
          items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          trx,
        );
      }

      await trx.commit();
    } catch (error) {
      await trx.rollback();
      throw error;
    }

    const items = await this.orderItemRepository.findByOrderId(updatedOrder.id);
    return {
      message: `Order status updated to ${data.status}`,
      data: OrderResponseDTO.from(updatedOrder, items),
    };
  };

  listCustomerOrders = async (customerId: number, params: IPaginationParams, filters: IFilterParams[] = [], year?: number) => {
    const { data: orders, meta } = await this.orderRepository.findByCustomer({ customerId, year }, params, filters);
    const orderIds = orders.map((o) => o.id);
    const items = await this.orderItemRepository.findByOrderIds(orderIds);

    const itemsByOrderId = new Map<number, OrderItemEntity[]>();
    for (const item of items) {
      const list = itemsByOrderId.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrderId.set(item.orderId, list);
    }

    return {
      message: 'Customer orders retrieved successfully',
      data: orders.map((o) => OrderResponseDTO.from(o, itemsByOrderId.get(o.id) ?? [])),
      meta,
    };
  };

  listBranchOrders = async (
    branchId: number,
    userId: number,
    userRole: string,
    params: IPaginationParams,
    filters: IFilterParams[] = [],
    status?: OrderStatus,
    from?: Date,
    to?: Date,
  ) => {
    const branch = await this.branchRepository.findById(branchId);
    if (!branch) {
      throw BranchNotAcceptingOrdersError;
    }

    // Verify restaurant member access
    if (userRole !== 'system_admin') {
      const member = await this.memberRepository.findRestaurantMemberWithRole(userId);
      if (!member || Number(member.member.restaurantId) !== Number(branch.restaurantId)) {
        throw RestaurantDoesNotMatchError;
      }
    }

    const { data: orders, meta } = await this.orderRepository.findByBranch({ branchId, status, from, to }, params, filters);
    const orderIds = orders.map((o) => o.id);
    const items = await this.orderItemRepository.findByOrderIds(orderIds);

    const itemsByOrderId = new Map<number, OrderItemEntity[]>();
    for (const item of items) {
      const list = itemsByOrderId.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrderId.set(item.orderId, list);
    }

    return {
      message: 'Branch orders retrieved successfully',
      data: orders.map((o) => OrderResponseDTO.from(o, itemsByOrderId.get(o.id) ?? [])),
      meta,
    };
  };

  releaseAssignedOrders = async (agentId: number) => {
    const hasPicked = await this.orderRepository.hasPickedOrders(agentId);
    if (hasPicked) {
      throw OfflineWhilePickedForbiddenError;
    }

    const releasedCount = await this.orderRepository.releaseAssignedOrderToReady(agentId);
    return {
      message: `Released ${releasedCount} assigned orders back to ready`,
      data: { releasedCount },
    };
  };

  // --- Private Helpers ---
  private assertAccess = async (order: OrderEntity, userId: number, userRole: string) => {
    if (userRole === 'system_admin') return;
    if (order.customerId === userId) return;
    if (order.agentId === userId) return;

    if (userRole === 'restaurant_user') {
      const memberData = await this.memberRepository.findRestaurantMemberWithRole(userId);
      if (memberData && Number(memberData.member.restaurantId) === Number(order.restaurantId)) {
        return;
      }
    }

    throw UnAuthorizedError;
  };

  private resolveStatusActor = async (order: OrderEntity, userId: number, userRole: string): Promise<StatusActor> => {
    if (userRole === 'system_admin') return StatusActor.ADMIN;
    if (order.agentId && order.agentId === userId) return StatusActor.AGENT;
    if (order.customerId === userId) return StatusActor.CUSTOMER;

    if (userRole === 'restaurant_user') {
      const memberData = await this.memberRepository.findRestaurantMemberWithRole(userId);
      if (memberData && Number(memberData.member.restaurantId) === Number(order.restaurantId)) {
        return StatusActor.RESTAURANT_MEMBER;
      }
    }

    throw UnAuthorizedError;
  };
}
