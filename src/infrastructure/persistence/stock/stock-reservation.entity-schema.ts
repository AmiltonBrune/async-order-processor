import { EntitySchema } from 'typeorm';

import { bigintTransformer } from '../../../shared/transformers';

export interface StockReservationRow {
  id: number;
  orderId: string;
  productId: number;
  quantity: number;
  reservedAt: Date;
}

export const StockReservationEntity = new EntitySchema<StockReservationRow>({
  name: 'StockReservation',
  tableName: 'stock_reservations',
  columns: {
    id: { type: 'bigint', primary: true, generated: 'increment', transformer: bigintTransformer },
    orderId: { type: 'char', length: 36, name: 'order_id' },
    productId: { type: 'bigint', name: 'product_id', transformer: bigintTransformer },
    quantity: { type: 'int', unsigned: true },
    reservedAt: { type: 'datetime', precision: 3, name: 'reserved_at' },
  },
  uniques: [{ name: 'uq_stock_reservations_order_product', columns: ['orderId', 'productId'] }],
});
