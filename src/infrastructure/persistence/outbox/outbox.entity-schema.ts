import { EntitySchema } from 'typeorm';

import { bigintTransformer } from '../../../shared/transformers';

export interface OutboxRow {
  id: number;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventName: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  lastError: string | null;
  availableAt: Date;
  publishedAt: Date | null;
  createdAt: Date;
}

export const OutboxEntity = new EntitySchema<OutboxRow>({
  name: 'OutboxMessage',
  tableName: 'outbox_messages',
  columns: {
    id: { type: 'bigint', primary: true, generated: 'increment', transformer: bigintTransformer },
    eventId: { type: 'char', length: 36, name: 'event_id' },
    aggregateType: { type: 'varchar', length: 32, name: 'aggregate_type' },
    aggregateId: { type: 'char', length: 36, name: 'aggregate_id' },
    eventName: { type: 'varchar', length: 64, name: 'event_name' },
    payload: { type: 'json' },
    status: { type: 'enum', enum: ['PENDING', 'PUBLISHED', 'FAILED'] },
    attempts: { type: 'int', unsigned: true },
    lastError: { type: 'varchar', length: 255, nullable: true, name: 'last_error' },
    availableAt: { type: 'datetime', precision: 3, name: 'available_at' },
    publishedAt: { type: 'datetime', precision: 3, nullable: true, name: 'published_at' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
  indices: [{ name: 'ix_outbox_dispatch', columns: ['status', 'availableAt', 'id'] }],
  uniques: [{ name: 'uq_outbox_event_id', columns: ['eventId'] }],
});
