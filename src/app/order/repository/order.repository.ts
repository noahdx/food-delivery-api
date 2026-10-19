import { Knex } from 'knex';
import { injectable } from 'tsyringe';
import {
  applyCursorPagination,
  applyFilters,
  buildPaginationResult,
  IFilterParams,
  IPaginationMeta,
  IPaginationParams,
} from '../../../lib/http/pagination/cursor-pagination';
import { db } from '../../../lib/knex/knex';
import { OrderEntity } from '../entity/order.entity';
import { OrderStatus } from '../types';

export interface IListCustomerOrdersFilter {
  customerId: number;
  year?: number;
}

export interface IListBranchOrdersFilter {
  branchId: number;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
}

export type IListRestaurantOrdersFilter = IListBranchOrdersFilter;

export interface IListOrdersResult {
  data: OrderEntity[];
  meta: IPaginationMeta;
}

@injectable()
export class OrderRepository {
  private COLUMNS = [
    'id',
    'public_id',
    'restaurant_id',
    'branch_id',
    'customer_id',
    'customer_address_id',
    'delivery_lat',
    'delivery_lng',
    'delivery_address_text_snapshot',
    'status',
    'subtotal',
    'delivery_fee',
    'service_fee',
    'total',
    'payment_method',
    'agent_id',
    'created_at',
    'updated_at',
    'accepted_at',
    'rejected_at',
    'ready_at',
    'assigned_at',
    'picked_at',
    'delivered_at',
    'cancelled_at',
  ];

  async create(data: Partial<OrderEntity>, trx: Knex = db): Promise<OrderEntity> {
    const [row] = await trx('orders')
      .insert({
        public_id: data.publicId,
        restaurant_id: data.restaurantId,
        branch_id: data.branchId,
        customer_id: data.customerId,
        customer_address_id: data.customerAddressId,
        delivery_lat: data.deliveryLat,
        delivery_lng: data.deliveryLng,
        delivery_address_text_snapshot: data.deliveryAddressTextSnapshot,
        status: data.status,
        subtotal: data.subtotal,
        delivery_fee: data.deliveryFee,
        service_fee: data.serviceFee,
        total: data.total,
        payment_method: data.paymentMethod,
        agent_id: data.agentId ?? null,
        created_at: data.createdAt ?? new Date(),
        updated_at: data.updatedAt ?? new Date(),
      })
      .returning(this.COLUMNS);

    return this.toEntity(row);
  }

  async findById(id: number, conn: Knex = db): Promise<OrderEntity | undefined> {
    const row = await conn('orders').where('id', id).select(this.COLUMNS).first();
    return row ? this.toEntity(row) : undefined;
  }

  async findByIds(ids: number[], conn: Knex = db): Promise<OrderEntity[]> {
    if (ids.length === 0) return [];
    const rows = await conn('orders').whereIn('id', ids).select(this.COLUMNS);
    return rows.map((r) => this.toEntity(r));
  }

  async findByPublicId(publicId: string, conn: Knex = db): Promise<OrderEntity | undefined> {
    const row = await conn('orders').where('public_id', publicId).select(this.COLUMNS).first();
    return row ? this.toEntity(row) : undefined;
  }

  async updateStatus(
    publicId: string,
    status: OrderStatus,
    timestampColumn?: string | null,
    conn: Knex = db,
  ): Promise<OrderEntity> {
    const updatePayload: Record<string, any> = {
      status,
      updated_at: new Date(),
    };

    if (timestampColumn) {
      updatePayload[timestampColumn] = new Date();
    }

    const [row] = await conn('orders').where('public_id', publicId).update(updatePayload).returning(this.COLUMNS);

    return this.toEntity(row);
  }


  async claimReadyOrderForAgent(publicId: string, agentId: number, conn: Knex = db): Promise<OrderEntity | undefined> {
    const [row] = await conn('orders')
      .where({ public_id: publicId, status: OrderStatus.READY })
      .whereNull('agent_id')
      .update({
        agent_id: agentId,
        status: OrderStatus.ASSIGNED,
        assigned_at: new Date(),
        updated_at: new Date(),
      })
      .returning(this.COLUMNS);

    return row ? this.toEntity(row) : undefined;
  }

  async assignOrderToAgent(publicId: string, agentId: number, conn: Knex = db): Promise<OrderEntity | undefined> {
    const [row] = await conn('orders')
      .where({ public_id: publicId })
      .update({
        agent_id: agentId,
        status: OrderStatus.ASSIGNED,
        assigned_at: new Date(),
        updated_at: new Date(),
      })
      .returning(this.COLUMNS);

    return row ? this.toEntity(row) : undefined;
  }

  async releaseAssignedOrderToReady(agentId: number, conn: Knex = db): Promise<number> {
    const updated = await conn('orders').where({ agent_id: agentId, status: OrderStatus.ASSIGNED }).update({
      status: OrderStatus.READY,
      agent_id: null,
      assigned_at: null,
      updated_at: new Date(),
    });

    return updated;
  }

  async findByCustomer(
    filter: IListCustomerOrdersFilter,
    pagination: IPaginationParams,
    extraFilters: IFilterParams[] = [],
    conn: Knex = db,
  ): Promise<IListOrdersResult> {
    let query = conn('orders').where('customer_id', filter.customerId).select(this.COLUMNS);

    if (filter.year) {
      const startOfYear = new Date(Date.UTC(filter.year, 0, 1)).toISOString();
      const startOfNextYear = new Date(Date.UTC(filter.year + 1, 0, 1)).toISOString();
      query = query.where('created_at', '>=', startOfYear).where('created_at', '<', startOfNextYear);
    }

    applyFilters(query, extraFilters);
    applyCursorPagination(query, pagination);
    const rows = await query;
    const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy || 'createdAt');

    return {
      data: result.data.map(this.toEntity),
      meta: result.meta,
    };
  }

  async findByBranch(
    filter: IListBranchOrdersFilter,
    pagination: IPaginationParams,
    extraFilters: IFilterParams[] = [],
    conn: Knex = db,
  ): Promise<IListOrdersResult> {
    let query = conn('orders').where('branch_id', filter.branchId).select(this.COLUMNS);

    if (filter.status) {
      query = query.where('status', filter.status);
    }

    if (filter.from) {
      query = query.where('created_at', '>=', filter.from);
    }

    if (filter.to) {
      query = query.where('created_at', '<', filter.to);
    }

    applyFilters(query, extraFilters);
    applyCursorPagination(query, pagination);
    const rows = await query;
    const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy || 'createdAt');

    return {
      data: result.data.map(this.toEntity),
      meta: result.meta,
    };
  }

  async hasPickedOrders(agentId: number, conn: Knex = db): Promise<boolean> {
    const row = await conn('orders').where({ agent_id: agentId, status: OrderStatus.PICKED }).select('id').first();
    return !!row;
  }

  async findAgentTasks(
    agentId: number,
    pagination: IPaginationParams,
    extraFilters: IFilterParams[] = [],
    statuses?: string[],
    conn: Knex = db,
  ): Promise<IListOrdersResult> {
    let query = conn('orders').where('agent_id', agentId).select(this.COLUMNS);

    if (statuses && statuses.length > 0) {
      query = query.whereIn('status', statuses);
    }

    applyFilters(query, extraFilters);
    applyCursorPagination(query, pagination);
    const rows = await query;
    const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy || 'assignedAt');

    return {
      data: result.data.map(this.toEntity),
      meta: result.meta,
    };
  }

  async findReadyUnassigned(
    pagination: IPaginationParams,
    extraFilters: IFilterParams[] = [],
    conn: Knex = db,
  ): Promise<IListOrdersResult> {
    let query = conn('orders').where('status', OrderStatus.READY).whereNull('agent_id').select(this.COLUMNS);

    applyFilters(query, extraFilters);
    applyCursorPagination(query, pagination);
    const rows = await query;
    const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy || 'createdAt');

    return {
      data: result.data.map(this.toEntity),
      meta: result.meta,
    };
  }

  private toEntity = (row: any): OrderEntity => {
    return new OrderEntity({
      id: Number(row.id),
      publicId: row.public_id,
      restaurantId: Number(row.restaurant_id),
      branchId: Number(row.branch_id),
      customerId: Number(row.customer_id),
      customerAddressId: Number(row.customer_address_id),
      deliveryLat: Number(row.delivery_lat),
      deliveryLng: Number(row.delivery_lng),
      deliveryAddressTextSnapshot: row.delivery_address_text_snapshot,
      status: row.status as OrderStatus,
      subtotal: Number(row.subtotal),
      deliveryFee: Number(row.delivery_fee),
      serviceFee: Number(row.service_fee),
      total: Number(row.total),
      paymentMethod: row.payment_method,
      agentId: row.agent_id ? Number(row.agent_id) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      acceptedAt: row.accepted_at,
      rejectedAt: row.rejected_at,
      readyAt: row.ready_at,
      assignedAt: row.assigned_at,
      pickedAt: row.picked_at,
      deliveredAt: row.delivered_at,
      cancelledAt: row.cancelled_at,
    });
  };
}
