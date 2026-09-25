import { OrderStatus } from '../../domain/order/order-status.enum';

export interface ListOrdersQuery {
  readonly page: number;
  readonly limit: number;
  readonly status?: OrderStatus;
  /**
   * Restringe a listagem aos pedidos desta identidade. Ausente significa "todos",
   * e só o papel ADMIN chega aqui com o campo ausente.
   */
  readonly createdBy?: string;
}

export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}
