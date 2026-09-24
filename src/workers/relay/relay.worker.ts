import { ENV } from '../../infrastructure/config/config.constants';
import { LOGGER } from '../../infrastructure/observability/correlation.constants';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';

import { CLOCK, Clock } from '../../domain/ports/system/clock.port';
import { RetryPolicy } from '../../domain/shared/retry-policy';
import { Env } from '../../infrastructure/config/env.schema';
import { OrderPublisher } from '../../infrastructure/messaging/orders/order.publisher';
import { CorrelationContext } from '../../infrastructure/observability/correlation.context';
import { StructuredLogger } from '../../infrastructure/observability/pino.logger';
import {
  OutboxDispatchRepository,
  PendingMessage,
} from '../../infrastructure/persistence/outbox/outbox-dispatch.repository';

@Injectable()
export class RelayWorker implements OnApplicationShutdown {
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly outbox: OutboxDispatchRepository,
    private readonly publisher: OrderPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.log('Relay iniciado', {
      intervaloMs: this.env.outboxPollIntervalMs,
      lote: this.env.outboxBatchSize,
    });
    this.loop = this.run();
  }

  async drainOnce(): Promise<number> {
    const now = this.clock.now();
    const batch = await this.outbox.claimBatch(this.env.outboxBatchSize, now);
    if (batch.length === 0) return 0;

    const published: number[] = [];
    for (const message of batch) {
      const correlationId = String(message.payload['correlationId'] ?? '');
      const ok = await CorrelationContext.run(correlationId, () => this.publish(message));
      if (ok) published.push(message.id);
    }
    await this.outbox.markPublished(published, this.clock.now());
    return published.length;
  }

  private async publish(message: PendingMessage): Promise<boolean> {
    try {
      await this.publisher.publishCreated(
        message.payload,
        String(message.payload['correlationId'] ?? ''),
      );
      this.logger.log('Evento publicado', { eventId: message.eventId });
      return true;
    } catch (error) {
      const reason = RetryPolicy.reasonOf(error);
      this.logger.error('Falha ao publicar evento da outbox', {
        eventId: message.eventId,
        tentativa: message.attempts + 1,
        motivo: reason,
      });
      const backoffMs = Math.min(2 ** message.attempts, 60) * 1_000;
      await this.outbox.markRetry(
        message.id,
        reason,
        new Date(this.clock.now().getTime() + backoffMs),
        this.env.maxPublishAttempts,
      );
      return false;
    }
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (error) {
        this.logger.error('Ciclo do relay falhou', { motivo: RetryPolicy.reasonOf(error) });
      }
      await this.sleep(this.env.outboxPollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
  }
}
