import { Injectable } from '@nestjs/common';
import { DataSource, LessThan } from 'typeorm';

import { InboxEntity } from './inbox.entity-schema';

@Injectable()
export class InboxRetentionRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * A inbox guarda a chave de toda entrega já vista, para reconhecer a
   * repetida. Passado o prazo de retentativa e de reentrega do broker, a linha
   * antiga não protege mais nada — só ocupa a tabela que a camada 1 consulta em
   * todo processamento.
   */
  async purgeProcessedBefore(corte: Date): Promise<number> {
    const resultado = await this.dataSource
      .getRepository(InboxEntity)
      .delete({ processedAt: LessThan(corte) });
    return resultado.affected ?? 0;
  }
}
