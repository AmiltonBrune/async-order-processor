import { Inject, Injectable } from '@nestjs/common';

import { Order } from '../../domain/order/order.entity';
import { ORDER_REPOSITORY, OrderRepository } from '../../domain/ports/repositories/order.repository.port';
import { ListOrdersQuery, PageMeta } from './list-orders.query';

export interface ListOrdersResult {
  readonly data: readonly Order[];
  readonly meta: PageMeta;
}

@Injectable()
export class ListOrdersUseCase {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository) {}

  /**
   * `escopo` é obrigatório de propósito: `null` significa "todos os pedidos" e é
   * uma decisão explícita de quem chama. Ver `GetOrderUseCase`.
   */
  async execute(query: ListOrdersQuery, escopo: string | null): Promise<ListOrdersResult> {
    const { data, total } = await this.orders.list({
      ...query,
      ...(escopo === null ? {} : { createdBy: escopo }),
    });
    return { data, meta: ListOrdersUseCase.metaOf(query, total) };
  }

  static metaOf(query: ListOrdersQuery, total: number): PageMeta {
    return {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
