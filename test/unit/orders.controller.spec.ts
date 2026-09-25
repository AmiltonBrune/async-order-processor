import { OrderItem } from '../../src/domain/order/order-item.entity';
import { Order } from '../../src/domain/order/order.entity';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { Money } from '../../src/domain/shared/money.vo';
import { OrdersController } from '../../src/interface/http/orders/orders.controller';

const pedido = (): Order =>
  Order.restore({
    id: '0193a000-0000-7000-8000-000000000001',
    customerName: 'Ana Souza',
    createdBy: 'cliente@loja.test',
    status: OrderStatus.PENDING,
    total: Money.of('20.00'),
    items: [new OrderItem(1, 'Teclado', Money.of('10.00'), 2)],
    failureCode: null,
    failureReason: null,
    processingAttempts: 0,
    correlationId: 'corr-1',
    processedAt: null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  });

const montar = () => {
  const createOrder = { execute: jest.fn(async () => pedido()) };
  const getOrder = { execute: jest.fn(async () => pedido()) };
  const listOrders = {
    execute: jest.fn(async () => ({
      data: [pedido()],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    })),
  };
  const reprocessOrder = { execute: jest.fn(async () => undefined) };
  const metrics = { contarPedidoCriado: jest.fn() };
  return {
    createOrder,
    getOrder,
    listOrders,
    reprocessOrder,
    metrics,
    controller: new OrdersController(
      createOrder as never,
      getOrder as never,
      listOrders as never,
      reprocessOrder as never,
      metrics as never,
    ),
  };
};

describe('OrdersController', () => {
  const corpo = {
    customerName: 'Ana Souza',
    createdBy: 'cliente@loja.test',
    items: [{ productName: 'Teclado', quantity: 2, price: '10.00' }],
  };

  it('repassa o correlationId da requisição ao caso de uso', () => {
    const { controller, createOrder } = montar();
    void controller.create(corpo as never, 'corr-9', 'cliente@loja.test');
    expect(createOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'corr-9' }),
    );
  });

  // O caso "sem header" mudou de dono: quem resolve o header agora é o
  // decorator @CorrelationId(). Está coberto em correlation-id.decorator.spec.ts.
  it('repassa correlationId vazio sem inventar valor', async () => {
    const { controller, createOrder } = montar();
    await controller.create(corpo as never, '', 'cliente@loja.test');
    expect(createOrder.execute).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: '' }),
    );
  });

  it('devolve o pedido já traduzido pelo presenter', async () => {
    const { controller } = montar();
    const resposta = await controller.create(corpo as never, '', 'cliente@loja.test');
    expect(resposta.total).toBe('20.00');
    expect(resposta.items[0]?.lineTotal).toBe('20.00');
    expect(resposta).not.toHaveProperty('processingAttempts');
  });

  it('lista traduzindo cada item e preservando o meta', async () => {
    const { controller } = montar();
    const resposta = await controller.list({ page: 1, limit: 20 } as never, null);
    expect(resposta.data).toHaveLength(1);
    expect(resposta.data[0]?.total).toBe('20.00');
    expect(resposta.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('consulta por id delega ao caso de uso', async () => {
    const { controller, getOrder } = montar();
    const resposta = await controller.byId('0193a000-0000-7000-8000-000000000001', null);
    expect(getOrder.execute).toHaveBeenCalledWith('0193a000-0000-7000-8000-000000000001', null);
    expect(resposta.id).toBe('0193a000-0000-7000-8000-000000000001');
  });

  it('reprocessamento devolve o estado para onde o pedido voltou', async () => {
    const { controller, reprocessOrder } = montar();
    const resposta = await controller.reprocess('id-1', 'corr-2');
    expect(reprocessOrder.execute).toHaveBeenCalledWith('id-1', 'corr-2');
    expect(resposta).toEqual({ status: 'PENDING' });
  });

  it('reprocessamento repassa correlationId vazio sem inventar valor', async () => {
    const { controller, reprocessOrder } = montar();
    await controller.reprocess('id-1', '');
    expect(reprocessOrder.execute).toHaveBeenCalledWith('id-1', '');
  });
});
