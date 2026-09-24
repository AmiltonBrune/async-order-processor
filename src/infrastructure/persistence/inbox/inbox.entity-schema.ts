import { EntitySchema } from 'typeorm';

export interface InboxRow {
  consumer: string;
  eventId: string;
  orderId: string;
  processedAt: Date;
}

export const InboxEntity = new EntitySchema<InboxRow>({
  name: 'InboxMessage',
  tableName: 'inbox_messages',
  columns: {
    consumer: { type: 'varchar', length: 64, primary: true },
    eventId: { type: 'char', length: 36, primary: true, name: 'event_id' },
    orderId: { type: 'char', length: 36, name: 'order_id' },
    processedAt: { type: 'datetime', precision: 3, name: 'processed_at' },
  },
});
