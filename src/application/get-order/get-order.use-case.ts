import { Inject, Injectable } from '@nestjs/common';

import { Order } from '../../domain/order/order.entity';
import { ORDER_REPOSITORY, OrderRepository } from '../../domain/ports/repositories/order.repository.port';
import { NotFoundError } from '../../domain/shared/errors';

@Injectable()
export class GetOrderUseCase {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository) {}

  /**
   * `escopo` é obrigatório de propósito: `null` significa acesso irrestrito e é
   * uma decisão explícita de quem chama. Fosse opcional, esquecer de passá-lo
   * devolveria o pedido de qualquer pessoa — um vazamento que compila.
   */
  async execute(id: string, escopo: string | null): Promise<Order> {
    const order = await this.orders.findById(id);
    if (order === null || !GetOrderUseCase.visivelPara(order, escopo)) {
      // Pedido de outro dono responde 404, não 403: 403 confirmaria que o id
      // existe, e isso já é informação.
      throw new NotFoundError('ORDER_NOT_FOUND', `Pedido nao encontrado: ${id}`);
    }
    return order;
  }

  private static visivelPara(order: Order, escopo: string | null): boolean {
    return escopo === null || order.createdBy === escopo;
  }
}
