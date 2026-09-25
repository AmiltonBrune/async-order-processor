import { ENV } from '../../config/config.constants';
import { LOGGER } from '../../observability/correlation.constants';
import { MAIN_QUEUE } from '../messaging.constants';
import { Inject, Injectable } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';

import { ProcessOrderUseCase } from '../../../application/process-order/process-order.use-case';
import { OrderCreatedEvent } from '../../../domain/order/events/order-created.event';
import { RetryPolicy } from '../../../domain/shared/retry-policy';

import { Env } from '../../config/env.schema';
import { StructuredLogger } from '../../observability/pino.logger';
import { METRICS } from '../../observability/metrics.constants';
import { PrometheusMetrics } from '../../observability/prometheus.metrics';
import { CorrelationContext } from '../../observability/correlation.context';
import { asTransientIfRetryable } from '../../persistence/errors/mysql.errors';
import { AmqpConnection } from '../amqp/amqp.connection';
import { MessageCodec } from '../codec/message.codec';
import { OrderPublisher } from './order.publisher';

@Injectable()
export class OrderConsumer {
  private readonly retryPolicy: RetryPolicy;
  private consumerTag: string | null = null;
  private inFlight = 0;

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly publisher: OrderPublisher,
    private readonly processOrder: ProcessOrderUseCase,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
    @Inject(METRICS) private readonly metrics: PrometheusMetrics,
  ) {
    this.retryPolicy = new RetryPolicy(env.retryTiersMs);
  }

  async start(): Promise<void> {
    const channel = await this.amqp.getChannel();
    const { consumerTag } = await channel.consume(
      MAIN_QUEUE,
      (message) => {
        if (message === null) return;
        void this.handle(message);
      },
      { noAck: false },
    );
    this.consumerTag = consumerTag;
    this.logger.log('Consumidor pronto', { fila: MAIN_QUEUE, prefetch: this.env.prefetch });
  }

  async stop(): Promise<void> {
    if (this.consumerTag === null) return;
    const channel = await this.amqp.getChannel();
    await channel.cancel(this.consumerTag);
    this.consumerTag = null;
    while (this.inFlight > 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private async handle(message: ConsumeMessage): Promise<void> {
    this.inFlight += 1;
    const channel = await this.amqp.getChannel();
    const headers = (message.properties.headers ?? {}) as Record<string, unknown>;

    let decoded;
    try {
      decoded = MessageCodec.decode(message.content, headers);
    } catch (error) {
      this.logger.error('Mensagem ilegivel na fila', { erro: RetryPolicy.reasonOf(error) });
      await this.publisher.publishDead({}, '', MessageCodec.attemptOf(headers), RetryPolicy.reasonOf(error));
      channel.ack(message);
      this.inFlight -= 1;
      return;
    }

    await CorrelationContext.run(decoded.correlationId, async () => {
      try {
        const event = OrderCreatedEvent.fromPayload(decoded.payload);
        CorrelationContext.attachOrderId(event.orderId);

        const outcome = await this.processOrder.execute({
          eventId: event.eventId,
          orderId: event.orderId,
          correlationId: event.correlationId,
          consumer: this.env.consumerName,
          attempt: decoded.attempt,
        });

        if (outcome === 'DEAD_LETTER') {
          this.logger.error('Evento sem pedido correspondente', { eventId: event.eventId });
          await this.publisher.publishDead(
            decoded.payload,
            decoded.correlationId,
            decoded.attempt,
            'Pedido inexistente para o evento',
          );
        } else {
          this.logger.log('Mensagem processada', { resultado: outcome, tentativa: decoded.attempt });
        }
        this.metrics.contarProcessamento(outcome);
        channel.ack(message);
      } catch (error) {
        await this.onFailure(error, decoded, message);
      } finally {
        this.inFlight -= 1;
      }
    });
  }

  private async onFailure(
    rawError: unknown,
    decoded: { payload: Record<string, unknown>; attempt: number; correlationId: string },
    message: ConsumeMessage,
  ): Promise<void> {
    const channel = await this.amqp.getChannel();
    const error = asTransientIfRetryable(rawError);
    const decision = this.retryPolicy.decide(error, decoded.attempt);

    if (decision.kind === 'FAIL_BUSINESS') {
      this.logger.error('Erro de negocio no consumo', { code: decision.code, motivo: decision.reason });
      await this.publisher.publishDead(decoded.payload, decoded.correlationId, decoded.attempt, decision.reason);
      channel.ack(message);
      return;
    }

    if (decision.kind === 'RETRY') {
      this.logger.warn('Falha transitoria: reenfileirando', {
        tentativa: decoded.attempt,
        proxima: decision.nextAttempt,
        esperaMs: decision.delayMs,
        motivo: RetryPolicy.reasonOf(error),
      });
      await this.publisher.publishRetry(
        decoded.payload,
        decoded.correlationId,
        decision.nextAttempt,
        RetryPolicy.reasonOf(error),
      );
      channel.ack(message);
      return;
    }

    const exhausted = RetryPolicy.exhausted(error);
    this.logger.error('Tentativas esgotadas: dead-letter', {
      tentativas: decoded.attempt,
      motivo: exhausted.message,
    });
    const orderId = decoded.payload['orderId'];
    if (typeof orderId === 'string') {
      await this.processOrder.failOrder(
        {
          eventId: String(decoded.payload['eventId']),
          orderId,
          correlationId: decoded.correlationId,
          consumer: this.env.consumerName,
          attempt: decoded.attempt,
        },
        exhausted,
      );
    }
    await this.publisher.publishDead(
      decoded.payload,
      decoded.correlationId,
      decoded.attempt,
      exhausted.message,
    );
    channel.ack(message);
  }
}
