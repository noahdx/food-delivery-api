import { inject, injectable } from 'tsyringe';
import { Knex } from 'knex';
import { tokens } from '../../../lib/di/tokens';
import { OrderEntity } from '../../order/entity/order.entity';
import { RestaurantBalanceRepository } from '../../finance/repository/restaurant-balance.repository';
import { AgentEarningRepository } from '../repository/agent-earning.repository';
import { PresenceService } from './presence.service';
import { AgentEarningEntity } from '../entity/agent-earning.entity';
import { RestaurantBalanceEntity } from '../../finance/entity/restaurant-balance.entity';
import { TransactionRepository } from '../../payment/repository/transaction.repository';
import { PaymentMethodType, TransactionStatus, TransactionType } from '../../payment/enums';
import { RestaurantRepository } from '../../restaurant/repository/restaurant.repository';
import { BranchRepository } from '../../branch/repository/branch.repository';

@injectable()
export class SettlementService {
  constructor(
    @inject(tokens.RestaurantBalanceRepository)
    private readonly balanceRepository: RestaurantBalanceRepository,
    @inject(tokens.AgentEarningRepository)
    private readonly earningRepository: AgentEarningRepository,
    @inject(tokens.PresenceService)
    private readonly presenceService: PresenceService,
    @inject(tokens.TransactionRepository)
    private readonly transactionRepository: TransactionRepository,
    @inject(tokens.RestaurantRepository)
    private readonly restaurantRepository: RestaurantRepository,
    @inject(tokens.BranchRepository)
    private readonly branchRepository: BranchRepository,
  ) {}

  settleOrder = async (
    order: OrderEntity,
    trx: Knex,
  ): Promise<{ balance: RestaurantBalanceEntity; earning?: AgentEarningEntity }> => {
    // 1. Calculate commission based on branch contract (bps)
    const branch = await this.branchRepository.findById(order.branchId);
    const commissionRate = branch?.commission ?? 0;
    const commission = Math.floor((order.subtotal * commissionRate) / 10000);

    // 2. Restaurant balance update: subtotal - commission
    const netRestaurantAmount = order.subtotal - commission;
    const balance = await this.balanceRepository.upsertIncrement(order.restaurantId, netRestaurantAmount, trx);

    // 3. Insert commission transaction if commission > 0
    if (commission > 0) {
      const restaurant = await this.restaurantRepository.findById(order.restaurantId);
      await this.transactionRepository.create(
        {
          orderId: order.id,
          transactionType: TransactionType.COMMISSION,
          method: PaymentMethodType.SYSTEM,
          status: TransactionStatus.SUCCEEDED,
          amount: commission,
          currency: 'EGP',
          srcAccId: restaurant?.ownerId ?? null,
          dstAccId: null,
          idempotencyKey: `commission:${order.publicId}`,
        },
        trx,
      );
    }

    // 3. Insert COD collection transaction if order was COD
    if (order.paymentMethod === 'cod') {
      await this.transactionRepository.create(
        {
          orderId: order.id,
          transactionType: TransactionType.COD_COLLECTION,
          method: PaymentMethodType.COD,
          status: TransactionStatus.SUCCEEDED,
          amount: order.total,
          currency: 'EGP',
          srcAccId: order.customerId,
          dstAccId: null,
          idempotencyKey: `cod-collect:${order.publicId}`,
        },
        trx,
      );
    }

    let earning: AgentEarningEntity | undefined;

    // 2. If delivery agent assigned, record agent earning (deliveryFee)
    if (order.agentId) {
      earning = await this.earningRepository.insert(
        {
          agentId: order.agentId,
          orderId: order.id,
          amount: order.deliveryFee,
          currency: 'EGP',
        },
        trx,
      );

      // 3. Clear agent from busy set
      await this.presenceService.clearBusy(order.agentId);
    }

    return { balance, earning };
  };
}
