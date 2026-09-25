import { GetOrderUseCase } from '../../src/application/get-order/get-order.use-case';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { NotFoundError } from '../../src/domain/shared/errors';
import { InMemoryDatabase, InMemoryOrderRepository } from '../support/in-memory';

describe('GetOrderUseCase', () => {
  it('devolve o pedido com o status atual', async () => {
    const db = new InMemoryDatabase();
    db.seedOrder({ id: 'order-1', status: OrderStatus.PROCESSED });
    const useCase = new GetOrderUseCase(new InMemoryOrderRepository(db));

    const pedido = await useCase.execute('order-1', null);

    expect(pedido.id).toBe('order-1');
    expect(pedido.status).toBe(OrderStatus.PROCESSED);
  });

  it('lanca erro tipado para id inexistente, em vez de devolver null', async () => {
    const useCase = new GetOrderUseCase(new InMemoryOrderRepository(new InMemoryDatabase()));
    await expect(useCase.execute('nao-existe', null)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe('escopo por dono', () => {
    const comDoisDonos = (): GetOrderUseCase => {
      const db = new InMemoryDatabase();
      db.seedOrder({ id: 'da-ana', createdBy: 'ana@loja.test' });
      db.seedOrder({ id: 'do-bruno', createdBy: 'bruno@loja.test' });
      return new GetOrderUseCase(new InMemoryOrderRepository(db));
    };

    it('o dono enxerga o próprio pedido', async () => {
      const pedido = await comDoisDonos().execute('da-ana', 'ana@loja.test');
      expect(pedido.id).toBe('da-ana');
    });

    // 404, não 403: um 403 confirmaria que o id existe, e isso já é informação
    // que o pedido de outra pessoa não deveria entregar.
    it('o pedido de outra pessoa responde como inexistente, não como proibido', async () => {
      await expect(comDoisDonos().execute('do-bruno', 'ana@loja.test')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('escopo nulo (ADMIN) enxerga o pedido de qualquer dono', async () => {
      const pedido = await comDoisDonos().execute('do-bruno', null);
      expect(pedido.id).toBe('do-bruno');
    });
  });
});
