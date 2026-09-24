import { QueryRunner } from 'typeorm';

import { OrderCreatedEvent } from '../../../domain/order/events/order-created.event';
import { OutboxRepository } from '../../../domain/ports/repositories/outbox.repository.port';
import { OutboxEntity } from './outbox.entity-schema';

export class TypeOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly runner: QueryRunner) {}

  async append(event: OrderCreatedEvent): Promise<void> {
    await this.runner.manager.getRepository(OutboxEntity).insert({
      eventId: event.eventId,
      aggregateType: 'Order',
      aggregateId: event.orderId,
      eventName: OrderCreatedEvent.NAME,
      payload: { ...event.toPayload() },
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      availableAt: event.occurredAt,
      publishedAt: null,
      createdAt: event.occurredAt,
    });
  }
}
