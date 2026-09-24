import { Inject, Injectable } from '@nestjs/common';

import { Order } from '../../domain/order/order.entity';
import { OrderStatus } from '../../domain/order/order-status.enum';
import { CLOCK, Clock } from '../../domain/ports/system/clock.port';
import {
  TransactionalRepositories,
  UNIT_OF_WORK,
  UnitOfWork,
} from '../../domain/ports/unit-of-work.port';
import { BusinessRuleViolation, TransientError, isBusinessError } from '../../domain/shared/errors';
import { ProcessOrderCommand, ProcessOrderOutcome } from './process-order.command';
import { PROCESSING_DELAY_MS } from './process-order.constants';


const JA_RESERVADO = Symbol('JaReservado');

@Injectable()
export class ProcessOrderUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PROCESSING_DELAY_MS) private readonly processingDelayMs: number,
  ) {}

  async execute(command: ProcessOrderCommand): Promise<ProcessOrderOutcome> {
    await this.simulateProcessing();

    try {
      return await this.unitOfWork.runInTransaction((repositories) =>
        this.reserveAndConclude(command, repositories),
      );
    } catch (error) {
      if (error === JA_RESERVADO) return 'DUPLICATE';
      if (isBusinessError(error)) {
        const registered = await this.failOrder(command, error);
        return registered ? 'FAILED' : 'DEAD_LETTER';
      }
      throw error;
    }
  }

  async failOrder(command: ProcessOrderCommand, error: BusinessRuleViolation): Promise<boolean> {
    return this.unitOfWork.runInTransaction(async (repositories) => {
      const order = await repositories.orders.findById(command.orderId);
      if (order === null || !order.isPending()) return false;
      order.markFailed(error.code, error.message, command.attempt);
      return repositories.orders.transitionStatus(order, OrderStatus.PENDING);
    });
  }

  private async reserveAndConclude(
    command: ProcessOrderCommand,
    repositories: TransactionalRepositories,
  ): Promise<ProcessOrderOutcome> {
    const now = this.clock.now();

    const isNewDelivery = await repositories.inbox.register(
      command.consumer,
      command.eventId,
      command.orderId,
      now,
    );
    if (!isNewDelivery) return 'DUPLICATE';

    const order = await repositories.orders.findById(command.orderId);
    if (order === null) {
      throw new BusinessRuleViolation(
        'ORDER_NOT_FOUND',
        `Evento de pedido inexistente: ${command.orderId}`,
      );
    }
    if (!order.isPending()) return 'DUPLICATE';

    this.applySimulatedFailureTrigger(order);

    // Camada 2 — o estado.
    order.markProcessed(now);
    const won = await repositories.orders.transitionStatus(order, OrderStatus.PENDING);
    if (!won) return 'DUPLICATE';

    // Camada 3 — o efeito. Itens em ordem crescente de product_id para que dois
    // pedidos com os mesmos produtos nunca formem ciclo de espera no InnoDB.
    const items = [...order.items].sort((a, b) => a.productId - b.productId);
    for (const item of items) {
      const fits = await repositories.products.decrementStock(item.productId, item.quantity);
      if (!fits) {
        throw new BusinessRuleViolation('INSUFFICIENT_STOCK', 'estoque insuficiente');
      }

      const reserved = await repositories.stock.reserve(
        order.id,
        item.productId,
        item.quantity,
        now,
      );
      if (!reserved) throw JA_RESERVADO;
    }
    return 'PROCESSED';
  }

  /**
   * Gatilho de falha do enunciado: `customerName` contendo "fail".
   *
   * Classificado como TRANSITORIO de proposito — e o unico caminho que exercita
   * a maquina de retentativa completa de ponta a ponta. Como erro de negocio, o
   * requisito 5 ("trate com retry e, apos esgotar, mova para dead-letter")
   * ficaria sem prova executavel.
   */
  private applySimulatedFailureTrigger(order: Order): void {
    if (order.customerName.toLowerCase().includes('fail')) {
      throw new TransientError(
        `Falha simulada no processamento do pedido de "${order.customerName}"`,
      );
    }
  }

  private async simulateProcessing(): Promise<void> {
    if (this.processingDelayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.processingDelayMs));
  }
}
