import { OrderStatus } from '../../domain/order/order-status.enum';

export interface ListOrdersQuery {
  readonly page: number;
  readonly limit: number;
  readonly status?: OrderStatus;
}

export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}
