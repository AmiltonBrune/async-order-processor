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

  async execute(query: ListOrdersQuery): Promise<ListOrdersResult> {
    const { data, total } = await this.orders.list(query);
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
