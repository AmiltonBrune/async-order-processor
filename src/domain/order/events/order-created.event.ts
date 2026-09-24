import { BusinessRuleViolation } from '../../shared/errors';

export interface OrderCreatedPayload {
  readonly eventId: string;
  readonly eventName: string;
  readonly version: number;
  readonly orderId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export class OrderCreatedEvent {
  static readonly NAME = 'order.created';
  static readonly VERSION = 1;

  constructor(
    readonly eventId: string,
    readonly orderId: string,
    readonly correlationId: string,
    readonly occurredAt: Date,
  ) {}

  toPayload(): OrderCreatedPayload {
    return {
      eventId: this.eventId,
      eventName: OrderCreatedEvent.NAME,
      version: OrderCreatedEvent.VERSION,
      orderId: this.orderId,
      correlationId: this.correlationId,
      occurredAt: this.occurredAt.toISOString(),
    };
  }

  static fromPayload(raw: unknown): OrderCreatedEvent {
    if (typeof raw !== 'object' || raw === null) {
      throw new BusinessRuleViolation('MALFORMED_EVENT', 'Payload do evento nao e um objeto');
    }
    const payload = raw as Partial<OrderCreatedPayload>;
    const missing = (['eventId', 'orderId', 'correlationId', 'occurredAt'] as const).filter(
      (field) => typeof payload[field] !== 'string' || payload[field] === '',
    );
    if (missing.length > 0) {
      throw new BusinessRuleViolation(
        'MALFORMED_EVENT',
        `Payload do evento sem os campos: ${missing.join(', ')}`,
      );
    }
    if (payload.eventName !== OrderCreatedEvent.NAME) {
      throw new BusinessRuleViolation(
        'MALFORMED_EVENT',
        `Evento inesperado na fila: ${String(payload.eventName)}`,
      );
    }
    if (payload.version !== OrderCreatedEvent.VERSION) {
      throw new BusinessRuleViolation(
        'MALFORMED_EVENT',
        `Versao de evento nao suportada: ${String(payload.version)}`,
      );
    }
    const occurredAt = new Date(String(payload.occurredAt));
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BusinessRuleViolation('MALFORMED_EVENT', 'occurredAt nao e uma data valida');
    }
    return new OrderCreatedEvent(
      String(payload.eventId),
      String(payload.orderId),
      String(payload.correlationId),
      occurredAt,
    );
  }
}
