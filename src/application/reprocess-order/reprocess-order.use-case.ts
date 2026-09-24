import { Inject, Injectable } from '@nestjs/common';

import { OrderCreatedEvent } from '../../domain/order/events/order-created.event';
import { OrderStatus } from '../../domain/order/order-status.enum';
import { CLOCK, Clock } from '../../domain/ports/system/clock.port';
import { ID_GENERATOR, IdGenerator } from '../../domain/ports/system/id-generator.port';
import { UNIT_OF_WORK, UnitOfWork } from '../../domain/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../domain/shared/errors';

@Injectable()
export class ReprocessOrderUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(orderId: string, correlationId: string): Promise<void> {
    await this.unitOfWork.runInTransaction(async (repositories) => {
      const order = await repositories.orders.findById(orderId);
      if (order === null) {
        throw new NotFoundError('ORDER_NOT_FOUND', `Pedido nao encontrado: ${orderId}`);
      }

      // O agregado já recusa a transição inválida, mas com o código genérico de
      // máquina de estado. Aqui a recusa ganha o código que o contrato da API
      // promete — quem chama precisa saber que o problema é o estado do pedido,
      // não uma transição interna qualquer.
      if (order.status !== OrderStatus.FAILED) {
        throw new ConflictError(
          'ORDER_NOT_REPROCESSABLE',
          `Pedido ${orderId} esta ${order.status}; so um pedido FAILED pode ser reprocessado`,
        );
      }
      order.requeueForReprocessing();

      // Dois cliques simultaneos no botao chegam os dois aqui. Quem perder a
      // corrida recebe affectedRows = 0 e vira 409 — nao um segundo evento.
      const won = await repositories.orders.transitionStatus(order, OrderStatus.FAILED);
      if (!won) {
        throw new ConflictError(
          'ORDER_NOT_REPROCESSABLE',
          `Pedido ${orderId} deixou de estar FAILED antes do reprocessamento`,
        );
      }

      await repositories.outbox.append(
        new OrderCreatedEvent(this.ids.next(), order.id, correlationId, this.clock.now()),
      );
    });
  }
}
