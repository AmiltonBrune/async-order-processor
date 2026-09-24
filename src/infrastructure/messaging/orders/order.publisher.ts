import { DEAD_EXCHANGE, EVENTS_EXCHANGE, ORDER_CREATED_ROUTING_KEY, RETRY_EXCHANGE } from '../messaging.constants';
import { Injectable } from '@nestjs/common';

import { AmqpConnection } from '../amqp/amqp.connection';
import { retryRoutingKey } from '../amqp/amqp.topology';
import { MessageCodec } from '../codec/message.codec';

@Injectable()
export class OrderPublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  async publishCreated(
    payload: Record<string, unknown>,
    correlationId: string,
    attempt = 1,
  ): Promise<void> {
    await this.publish(EVENTS_EXCHANGE, ORDER_CREATED_ROUTING_KEY, payload, attempt, correlationId);
  }

  async publishRetry(
    payload: Record<string, unknown>,
    correlationId: string,
    attempt: number,
    reason: string,
  ): Promise<void> {
    await this.publish(
      RETRY_EXCHANGE,
      retryRoutingKey(attempt - 1),
      payload,
      attempt,
      correlationId,
      reason,
    );
  }

  async publishDead(
    payload: Record<string, unknown>,
    correlationId: string,
    attempt: number,
    reason: string,
  ): Promise<void> {
    await this.publish(DEAD_EXCHANGE, '', payload, attempt, correlationId, reason);
  }

  private async publish(
    exchange: string,
    routingKey: string,
    payload: Record<string, unknown>,
    attempt: number,
    correlationId: string,
    reason?: string,
  ): Promise<void> {
    const channel = await this.amqp.getChannel();
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        exchange,
        routingKey,
        MessageCodec.encode(payload),
        {
          persistent: true,
          contentType: 'application/json',
          correlationId,
          headers: MessageCodec.headersFor(attempt, correlationId, reason),
        },
        (error) => (error === null ? resolve() : reject(error)),
      );
    });
  }
}
