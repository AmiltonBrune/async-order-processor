import { GetOrderUseCase } from '../../src/application/get-order/get-order.use-case';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { NotFoundError } from '../../src/domain/shared/errors';
import { InMemoryDatabase, InMemoryOrderRepository } from '../support/in-memory';

describe('GetOrderUseCase', () => {
  it('devolve o pedido com o status atual', async () => {
    const db = new InMemoryDatabase();
    db.seedOrder({ id: 'order-1', status: OrderStatus.PROCESSED });
    const useCase = new GetOrderUseCase(new InMemoryOrderRepository(db));

    const pedido = await useCase.execute('order-1');

    expect(pedido.id).toBe('order-1');
    expect(pedido.status).toBe(OrderStatus.PROCESSED);
  });

  it('lanca erro tipado para id inexistente, em vez de devolver null', async () => {
    const useCase = new GetOrderUseCase(new InMemoryOrderRepository(new InMemoryDatabase()));
    await expect(useCase.execute('nao-existe')).rejects.toBeInstanceOf(NotFoundError);
  });
});
