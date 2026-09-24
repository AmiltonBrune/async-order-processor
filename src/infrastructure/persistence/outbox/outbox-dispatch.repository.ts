import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { OutboxEntity } from './outbox.entity-schema';

export interface PendingMessage {
  readonly id: number;
  readonly eventId: string;
  readonly eventName: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
}

@Injectable()
export class OutboxDispatchRepository {
  private static readonly JANELA_DE_RESERVA_SEGUNDOS = 30;

  constructor(private readonly dataSource: DataSource) {}

  async claimBatch(batchSize: number, now: Date): Promise<readonly PendingMessage[]> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const rows = await runner.manager
        .createQueryBuilder(OutboxEntity, 'outbox')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('outbox.status = :status', { status: 'PENDING' })
        .andWhere('outbox.availableAt <= :now', { now })
        .orderBy('outbox.id', 'ASC')
        .limit(batchSize)
        .getMany();

      if (rows.length > 0) {
        await runner.manager
          .createQueryBuilder()
          .update(OutboxEntity)
          .set({
            availableAt: () => `DATE_ADD(:now, INTERVAL ${OutboxDispatchRepository.JANELA_DE_RESERVA_SEGUNDOS} SECOND)`,
          })
          .where('id IN (:...ids)', { ids: rows.map((row) => row.id), now })
          .execute();
      }
      await runner.commitTransaction();

      return rows.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        eventName: row.eventName,
        // Objeto, sempre: quem garante é o mapeamento (`type: 'json'` na
        // entidade). Havia aqui um `typeof === 'string' ? JSON.parse(...)` de
        // defesa, herdado da época em que o acesso era por SQL cru — com o
        // mapeamento no lugar, virou ramo que nenhum teste alcança porque
        // nenhuma execução alcança.
        payload: row.payload,
        attempts: row.attempts,
      }));
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      // No `finally`: sem isto, cada falha vaza uma conexão do pool até o relay
      // parar de conseguir abrir transação.
      await runner.release();
    }
  }

  /** Só depois do publisher confirm do broker. */
  async markPublished(ids: readonly number[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.dataSource
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({ status: 'PUBLISHED', publishedAt: at })
      .where('id IN (:...ids)', { ids: [...ids] })
      .execute();
  }

  async markRetry(
    id: number,
    error: string,
    nextAttemptAt: Date,
    maxAttempts: number,
  ): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update(OutboxEntity)
      .set({
        attempts: () => 'attempts + 1',
        lastError: error.slice(0, 255),
        availableAt: nextAttemptAt,
        // Estourou o teto: vira FAILED e fica visível para alarme, em vez de
        // ficar tentando para sempre.
        status: () => 'IF(attempts + 1 >= :maxAttempts, "FAILED", "PENDING")',
      })
      .where('id = :id', { id, maxAttempts })
      .execute();
  }
}
