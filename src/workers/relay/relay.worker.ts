import { ENV } from '../../infrastructure/config/config.constants';
import { LOGGER } from '../../infrastructure/observability/correlation.constants';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';

import { CLOCK, Clock } from '../../domain/ports/system/clock.port';
import { RetryPolicy } from '../../domain/shared/retry-policy';
import { Env } from '../../infrastructure/config/env.schema';
import { OrderPublisher } from '../../infrastructure/messaging/orders/order.publisher';
import { CorrelationContext } from '../../infrastructure/observability/correlation.context';
import { METRICS } from '../../infrastructure/observability/metrics.constants';
import { PrometheusMetrics } from '../../infrastructure/observability/prometheus.metrics';
import { StructuredLogger } from '../../infrastructure/observability/pino.logger';
import { InboxRetentionRepository } from '../../infrastructure/persistence/inbox/inbox-retention.repository';
import {
  OutboxDispatchRepository,
  PendingMessage,
} from '../../infrastructure/persistence/outbox/outbox-dispatch.repository';
import { OutboxRetentionRepository } from '../../infrastructure/persistence/outbox/outbox-retention.repository';

@Injectable()
export class RelayWorker implements OnApplicationShutdown {
  private static readonly INTERVALO_DE_EXPURGO_MS = 60 * 60 * 1000;

  private running = false;
  private loop: Promise<void> | null = null;
  private proximoExpurgoEm = 0;

  constructor(
    private readonly outbox: OutboxDispatchRepository,
    private readonly outboxRetention: OutboxRetentionRepository,
    private readonly inboxRetention: InboxRetentionRepository,
    private readonly publisher: OrderPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
    @Inject(METRICS) private readonly metrics: PrometheusMetrics,
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
        await this.publicarMetricasDaOutbox();
        await this.expurgarSeChegouAHora();
      } catch (error) {
        this.logger.error('Ciclo do relay falhou', { motivo: RetryPolicy.reasonOf(error) });
      }
      await this.sleep(this.env.outboxPollIntervalMs);
    }
  }

  /**
   * As gauges saem daqui, e não de uma consulta no scrape do Prometheus: o
   * relay já está de pé a cada ciclo, e assim a coleta não adiciona carga ao
   * banco proporcional ao número de scrapers.
   */
  private async publicarMetricasDaOutbox(): Promise<void> {
    const { pendentes, idadeDaMaisAntigaSegundos } = await this.outbox.pendingStats(
      this.clock.now(),
    );
    this.metrics.registrarOutbox(pendentes, idadeDaMaisAntigaSegundos);
  }

  /**
   * O expurgo mora no relay porque ele já é o processo de manutenção da outbox,
   * e roda uma vez por hora — não a cada ciclo de 500 ms, que transformaria uma
   * limpeza de rotina em carga constante no banco.
   */
  async expurgarSeChegouAHora(): Promise<void> {
    const agora = this.clock.now().getTime();
    if (agora < this.proximoExpurgoEm) return;
    this.proximoExpurgoEm = agora + RelayWorker.INTERVALO_DE_EXPURGO_MS;

    const corte = new Date(agora - this.env.retentionDays * 24 * 60 * 60 * 1000);
    const outbox = await this.outboxRetention.purgePublishedBefore(corte);
    const inbox = await this.inboxRetention.purgeProcessedBefore(corte);
    if (outbox + inbox > 0) {
      this.logger.log('Expurgo de histórico concluído', {
        corte: corte.toISOString(),
        outbox,
        inbox,
      });
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
