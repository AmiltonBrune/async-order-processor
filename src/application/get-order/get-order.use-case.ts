import { Inject, Injectable } from '@nestjs/common';

import { Order } from '../../domain/order/order.entity';
import { ORDER_REPOSITORY, OrderRepository } from '../../domain/ports/repositories/order.repository.port';
import { NotFoundError } from '../../domain/shared/errors';

@Injectable()
export class GetOrderUseCase {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository) {}

  async execute(id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    if (order === null) {
      throw new NotFoundError('ORDER_NOT_FOUND', `Pedido nao encontrado: ${id}`);
    }
    return order;
  }
}
