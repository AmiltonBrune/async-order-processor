import { EntitySchema } from 'typeorm';

import { Money } from '../../../domain/shared/money.vo';
import { bigintTransformer, moneyTransformer } from '../../../shared/transformers';

export interface OrderItemRow {
  id: number;
  orderId: string;
  productId: number;
  productName: string;
  unitPrice: Money;
  quantity: number;
}

export const OrderItemEntity = new EntitySchema<OrderItemRow>({
  name: 'OrderItem',
  tableName: 'order_items',
  columns: {
    id: { type: 'bigint', primary: true, generated: 'increment', transformer: bigintTransformer },
    orderId: { type: 'char', length: 36, name: 'order_id' },
    productId: { type: 'bigint', name: 'product_id', transformer: bigintTransformer },
    productName: { type: 'varchar', length: 128, name: 'product_name' },
    unitPrice: {
      type: 'decimal',
      precision: 12,
      scale: 2,
      name: 'unit_price',
      transformer: moneyTransformer,
    },
    quantity: { type: 'int', unsigned: true },
  },
  uniques: [{ name: 'uq_order_items_order_product', columns: ['orderId', 'productId'] }],
});
