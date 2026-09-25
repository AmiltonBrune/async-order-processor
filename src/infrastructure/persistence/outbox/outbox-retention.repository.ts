import { Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';

import { OutboxEntity } from './outbox.entity-schema';

@Injectable()
export class OutboxRetentionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * A outbox guarda toda mensagem já publicada e nunca esquece nada. Sem
   * expurgo, o índice de despacho — `(status, available_at, id)` — cresce junto
   * com o histórico, e o relay passa a varrer anos de mensagens publicadas para
   * achar as poucas pendentes.
   *
   * Só apaga o que está `PUBLISHED`: pendente e falha ficam, custe o que custar.
   */
  async purgePublishedBefore(corte: Date): Promise<number> {
    const resultado = await this.dataSource
      .getRepository(OutboxEntity)
      .delete({ status: 'PUBLISHED', publishedAt: LessThan(corte) });
    return resultado.affected ?? 0;
  }
}
