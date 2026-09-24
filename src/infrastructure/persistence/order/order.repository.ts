import { In, QueryRunner } from 'typeorm';

import { OrderItem } from '../../../domain/order/order-item.entity';
import { Order } from '../../../domain/order/order.entity';
import { OrderStatus } from '../../../domain/order/order-status.enum';
import { Page } from '../../../domain/ports/pagination.port';
import { ListOrdersFilter, OrderRepository } from '../../../domain/ports/repositories/order.repository.port';
import { FailureCode } from '../../../domain/shared/errors';
import { OrderItemEntity, OrderItemRow } from './order-item.entity-schema';
import { OrderEntity, OrderRow } from './order.entity-schema';

export class TypeOrmOrderRepository implements OrderRepository {
  constructor(private readonly runner: QueryRunner) {}

  async insert(order: Order): Promise<void> {
    await this.runner.manager.getRepository(OrderEntity).insert({
      id: order.id,
      customerName: order.customerName,
      status: order.status,
      totalAmount: order.total,
      currency: order.total.currency,
      failureCode: null,
      failureReason: null,
      processingAttempts: 0,
      correlationId: order.correlationId,
      processedAt: null,
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
    });

    await this.runner.manager.getRepository(OrderItemEntity).insert(
      order.items.map((item) => ({
        orderId: order.id,
        productId: item.productId,
        productName: item.productName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      })),
    );
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.runner.manager.getRepository(OrderEntity).findOne({ where: { id } });
    if (row === null) return null;
    return this.hydrate(row, await this.itemsOf([id]));
  }

  async list(filter: ListOrdersFilter): Promise<Page<Order>> {
    const [rows, total] = await this.runner.manager.getRepository(OrderEntity).findAndCount({
      where: filter.status === undefined ? {} : { status: filter.status },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (filter.page - 1) * filter.limit,
      take: filter.limit,
    });
    if (rows.length === 0) return { data: [], total };

    const items = await this.itemsOf(rows.map((row) => row.id));
    return { data: rows.map((row) => this.hydrate(row, items)), total };
  }

  async transitionStatus(order: Order, from: OrderStatus): Promise<boolean> {
    const resultado = await this.runner.manager
      .createQueryBuilder()
      .update(OrderEntity)
      .set({
        status: order.status,
        failureCode: order.failureCode,
        failureReason: order.failureReason,
        processingAttempts: order.processingAttempts,
        processedAt: order.processedAt,
      })
      .where('id = :id AND status = :from', { id: order.id, from })
      .execute();
    return resultado.affected === 1;
  }

  private async itemsOf(orderIds: readonly string[]): Promise<OrderItemRow[]> {
    return this.runner.manager.getRepository(OrderItemEntity).find({
      where: { orderId: In([...orderIds]) },
      order: { productId: 'ASC' },
    });
  }

  private hydrate(row: OrderRow, items: readonly OrderItemRow[]): Order {
    return Order.restore({
      id: row.id,
      customerName: row.customerName,
      status: row.status,
      total: row.totalAmount,
      items: items
        .filter((item) => item.orderId === row.id)
        .map((item) => new OrderItem(item.productId, item.productName, item.unitPrice, item.quantity)),
      failureCode: row.failureCode as FailureCode | null,
      failureReason: row.failureReason,
      processingAttempts: row.processingAttempts,
      correlationId: row.correlationId,
      processedAt: row.processedAt,
      createdAt: row.createdAt,
    });
  }
}
