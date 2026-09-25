import { ListOrdersUseCase } from '../../src/application/list-orders/list-orders.use-case';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { InMemoryDatabase, InMemoryOrderRepository } from '../support/in-memory';

const comPedidos = (quantidade: number, status = OrderStatus.PENDING) => {
  const db = new InMemoryDatabase();
  for (let i = 1; i <= quantidade; i += 1) db.seedOrder({ id: `order-${i}`, status });
  return new ListOrdersUseCase(new InMemoryOrderRepository(db));
};

describe('ListOrdersUseCase', () => {
  it('pagina e devolve os metadados', async () => {
    const resultado = await comPedidos(12).execute({ page: 1, limit: 5 }, null);
    expect(resultado.data).toHaveLength(5);
    expect(resultado.meta).toEqual({ page: 1, limit: 5, total: 12, totalPages: 3 });
  });

  it('devolve a ultima pagina parcial', async () => {
    const resultado = await comPedidos(12).execute({ page: 3, limit: 5 }, null);
    expect(resultado.data).toHaveLength(2);
  });

  it('devolve lista vazia com 200 alem do fim, nao erro', async () => {
    const resultado = await comPedidos(12).execute({ page: 4, limit: 5 }, null);
    expect(resultado.data).toHaveLength(0);
    expect(resultado.meta.total).toBe(12);
  });

  it('filtra por status', async () => {
    const db = new InMemoryDatabase();
    for (let i = 1; i <= 3; i += 1) db.seedOrder({ id: `p-${i}`, status: OrderStatus.PROCESSED });
    for (let i = 1; i <= 2; i += 1) db.seedOrder({ id: `f-${i}`, status: OrderStatus.FAILED });
    const useCase = new ListOrdersUseCase(new InMemoryOrderRepository(db));

    const resultado = await useCase.execute({ page: 1, limit: 10, status: OrderStatus.FAILED }, null);

    expect(resultado.data).toHaveLength(2);
    expect(resultado.meta.total).toBe(2);
    expect(resultado.data.every((pedido) => pedido.status === OrderStatus.FAILED)).toBe(true);
  });

  describe('totalPages', () => {
    it.each([
      [10, 5, 2],
      [11, 5, 3],
      [1, 5, 1],
      [0, 5, 0],
      [100, 100, 1],
    ])('com total %i e limite %i devolve %i paginas', (total, limit, esperado) => {
      // Os dois erros classicos: divisao exata (10/5 = 2, nao 3) e total zero
      // (0 paginas, nao 1 pagina vazia que o cliente tenta buscar).
      expect(ListOrdersUseCase.metaOf({ page: 1, limit }, total).totalPages).toBe(esperado);
    });
  });

  describe('escopo por dono', () => {
    const comDoisDonos = (): ListOrdersUseCase => {
      const db = new InMemoryDatabase();
      for (const id of ['a1', 'a2', 'a3']) db.seedOrder({ id, createdBy: 'ana@loja.test' });
      for (const id of ['b1', 'b2']) db.seedOrder({ id, createdBy: 'bruno@loja.test' });
      return new ListOrdersUseCase(new InMemoryOrderRepository(db));
    };

    it('lista apenas os pedidos do dono, e o total reflete só eles', async () => {
      const resultado = await comDoisDonos().execute({ page: 1, limit: 10 }, 'ana@loja.test');

      expect(resultado.data.map((pedido) => pedido.id)).toEqual(['a1', 'a2', 'a3']);
      expect(resultado.meta.total).toBe(3);
      expect(resultado.meta.totalPages).toBe(1);
    });

    it('escopo nulo (ADMIN) lista os pedidos de todo mundo', async () => {
      const resultado = await comDoisDonos().execute({ page: 1, limit: 10 }, null);
      expect(resultado.meta.total).toBe(5);
    });

    it('o escopo combina com o filtro de status em vez de substituí-lo', async () => {
      const db = new InMemoryDatabase();
      db.seedOrder({ id: 'a1', createdBy: 'ana@loja.test', status: OrderStatus.FAILED });
      db.seedOrder({ id: 'a2', createdBy: 'ana@loja.test', status: OrderStatus.PENDING });
      db.seedOrder({ id: 'b1', createdBy: 'bruno@loja.test', status: OrderStatus.FAILED });
      const useCase = new ListOrdersUseCase(new InMemoryOrderRepository(db));

      const resultado = await useCase.execute(
        { page: 1, limit: 10, status: OrderStatus.FAILED },
        'ana@loja.test',
      );

      expect(resultado.data.map((pedido) => pedido.id)).toEqual(['a1']);
    });
  });
});
