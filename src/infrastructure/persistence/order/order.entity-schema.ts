import { EntitySchema } from 'typeorm';

import { OrderStatus } from '../../../domain/order/order-status.enum';
import { Money } from '../../../domain/shared/money.vo';
import { moneyTransformer } from '../../../shared/transformers';

export interface OrderRow {
  id: string;
  customerName: string;
  status: OrderStatus;
  totalAmount: Money;
  currency: string;
  failureCode: string | null;
  failureReason: string | null;
  processingAttempts: number;
  correlationId: string;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const OrderEntity = new EntitySchema<OrderRow>({
  name: 'Order',
  tableName: 'orders',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    customerName: { type: 'varchar', length: 160, name: 'customer_name' },
    status: { type: 'enum', enum: OrderStatus },
    totalAmount: {
      type: 'decimal',
      precision: 12,
      scale: 2,
      name: 'total_amount',
      transformer: moneyTransformer,
    },
    currency: { type: 'char', length: 3 },
    failureCode: { type: 'varchar', length: 40, nullable: true, name: 'failure_code' },
    failureReason: { type: 'varchar', length: 255, nullable: true, name: 'failure_reason' },
    processingAttempts: { type: 'int', unsigned: true, name: 'processing_attempts' },
    correlationId: { type: 'char', length: 36, name: 'correlation_id' },
    processedAt: { type: 'datetime', precision: 3, nullable: true, name: 'processed_at' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
  },
  indices: [
    { name: 'ix_orders_created_at', columns: ['createdAt', 'id'] },
    { name: 'ix_orders_status_created_at', columns: ['status', 'createdAt', 'id'] },
    { name: 'ix_orders_correlation_id', columns: ['correlationId'] },
  ],
});
