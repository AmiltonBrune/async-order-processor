import { OrderCreatedEvent } from '../../order/events/order-created.event';

export interface OutboxRepository {
  append(event: OrderCreatedEvent): Promise<void>;
}
