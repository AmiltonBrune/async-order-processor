import { OrderStatus } from '../../order/order-status.enum';
import { Order } from '../../order/order.entity';
import { Page } from '../pagination.port';

export const ORDER_REPOSITORY = Symbol('OrderRepository');

export interface ListOrdersFilter {
  readonly page: number;
  readonly limit: number;
  readonly status?: OrderStatus;
}

export interface OrderRepository {
  insert(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  list(filter: ListOrdersFilter): Promise<Page<Order>>;
  transitionStatus(order: Order, from: OrderStatus): Promise<boolean>;
}
