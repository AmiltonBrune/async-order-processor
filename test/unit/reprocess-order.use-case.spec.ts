import { ReprocessOrderUseCase } from '../../src/application/reprocess-order/reprocess-order.use-case';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { ConflictError, NotFoundError } from '../../src/domain/shared/errors';
import {
  FixedClock,
  InMemoryDatabase,
  InMemoryOrderRepository,
  InMemoryUnitOfWork,
  SequentialIdGenerator,
} from '../support/in-memory';

const montar = () => {
  const db = InMemoryDatabase.withCatalog(['Teclado', 5]);
  const unitOfWork = new InMemoryUnitOfWork(db);
  const useCase = new ReprocessOrderUseCase(unitOfWork, new FixedClock(), new SequentialIdGenerator());
  return { db, useCase };
};

const pedidoFalhado = (db: InMemoryDatabase) =>
  db.seedOrder({
    id: 'order-1',
    status: OrderStatus.FAILED,
    failureCode: 'INSUFFICIENT_STOCK',
    failureReason: 'estoque insuficiente',
  });

describe('ReprocessOrderUseCase', () => {
  it('devolve o pedido para PENDING limpando o motivo da falha', async () => {
    const { db, useCase } = montar();
    pedidoFalhado(db);

    await useCase.execute('order-1', 'corr-2');

    const pedido = db.orderById('order-1');
    expect(pedido.status).toBe(OrderStatus.PENDING);
    expect(pedido.failureCode).toBeNull();
    expect(pedido.failureReason).toBeNull();
  });

  it('grava um evento NOVO na outbox', async () => {
    const { db, useCase } = montar();
    pedidoFalhado(db);
    db.inbox.push({ consumer: 'order-processor', eventId: 'evt-antigo' });

    await useCase.execute('order-1', 'corr-2');

    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0]?.eventId).not.toBe('evt-antigo');
    expect(db.outbox[0]?.correlationId).toBe('corr-2');
  });

  it('NAO apaga as reservas anteriores', async () => {
    const { db, useCase } = montar();
    pedidoFalhado(db);
    db.reservations.push({ orderId: 'order-1', productId: 1, quantity: 2 });

    await useCase.execute('order-1', 'corr-2');

    expect(db.reservations).toHaveLength(1);
  });

  it.each([OrderStatus.PENDING, OrderStatus.PROCESSED])(
    'recusa reprocessar pedido %s sem gravar evento',
    async (status) => {
      const { db, useCase } = montar();
      db.seedOrder({ id: 'order-1', status });

      await expect(useCase.execute('order-1', 'corr-2')).rejects.toBeInstanceOf(ConflictError);
      expect(db.outbox).toHaveLength(0);
      expect(db.orderById('order-1').status).toBe(status);
    },
  );

  it('recusa pedido inexistente', async () => {
    const { useCase } = montar();
    await expect(useCase.execute('nao-existe', 'corr-2')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('quem perde a corrida do UPDATE condicional vira conflito, nao um segundo evento', async () => {
    const { db, useCase } = montar();
    pedidoFalhado(db);
    jest.spyOn(InMemoryOrderRepository.prototype, 'transitionStatus').mockResolvedValueOnce(false);

    await expect(useCase.execute('order-1', 'corr-2')).rejects.toBeInstanceOf(ConflictError);

    expect(db.outbox).toHaveLength(0);
  });

  it.each([
    ['PENDING', OrderStatus.PENDING],
    ['PROCESSED', OrderStatus.PROCESSED],
  ])('recusa reprocessar pedido %s com o código do contrato da API', async (_nome, status) => {
    const { db, useCase } = montar();
    db.seedOrder({ id: 'order-1', status });

    const erro = await useCase.execute('order-1', 'corr-1').catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(ConflictError);
    expect((erro as ConflictError).code).toBe('ORDER_NOT_REPROCESSABLE');
    expect(db.orderById('order-1').status).toBe(status);
    expect(db.outbox).toHaveLength(0);
  });
});
