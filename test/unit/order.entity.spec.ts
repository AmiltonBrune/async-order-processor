import { OrderItem } from '../../src/domain/order/order-item.entity';
import { Order } from '../../src/domain/order/order.entity';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { ConflictError } from '../../src/domain/shared/errors';
import { Money } from '../../src/domain/shared/money.vo';

const AGORA = new Date('2026-01-01T10:00:00.000Z');

const novoPedido = (): Order =>
  Order.create({
    id: 'order-1',
    customerName: 'Ana Souza',
    items: [new OrderItem(1, 'Teclado', Money.of('10.00'), 2)],
    correlationId: 'corr-1',
    now: AGORA,
  });

const pedidoNoStatus = (status: OrderStatus): Order =>
  Order.restore({
    id: 'order-1',
    customerName: 'Ana Souza',
    status,
    total: Money.of('20.00'),
    items: [new OrderItem(1, 'Teclado', Money.of('10.00'), 2)],
    failureCode: status === OrderStatus.FAILED ? 'INSUFFICIENT_STOCK' : null,
    failureReason: status === OrderStatus.FAILED ? 'estoque insuficiente' : null,
    processingAttempts: 0,
    correlationId: 'corr-1',
    processedAt: null,
    createdAt: AGORA,
  });

describe('Order', () => {
  it('nasce PENDING com o total calculado e sem motivo de falha', () => {
    const pedido = novoPedido();
    expect(pedido.status).toBe(OrderStatus.PENDING);
    expect(pedido.total.toFixed2()).toBe('20.00');
    expect(pedido.failureCode).toBeNull();
    expect(pedido.processedAt).toBeNull();
  });

  // `calculateOrderTotal` também lança RangeError com lista vazia, e a mensagem
  // dele ("...um item para ter total") CONTÉM a do agregado — por isso a
  // asserção é ancorada. Sem a âncora, a guarda do agregado podia sumir e o
  // teste continuaria verde, casando com a mensagem do calculador.
  // É a mensagem que prova qual das duas recusou, e que a recusa veio ANTES de
  // delegar o cálculo.
  it('recusa nascer sem item ou sem cliente, cada uma com a sua razão', () => {
    expect(() =>
      Order.create({ id: 'x', customerName: 'Ana', items: [], correlationId: 'c', now: AGORA }),
    ).toThrow(/^Pedido precisa de pelo menos um item$/);
    expect(() =>
      Order.create({
        id: 'x',
        customerName: '   ',
        items: [new OrderItem(1, 'Teclado', Money.of('10.00'), 1)],
        correlationId: 'c',
        now: AGORA,
      }),
    ).toThrow('Pedido precisa de um nome de cliente');
  });

  describe('markProcessed', () => {
    it('leva de PENDING para PROCESSED registrando quando', () => {
      const pedido = novoPedido();
      pedido.markProcessed(AGORA);
      expect(pedido.status).toBe(OrderStatus.PROCESSED);
      expect(pedido.processedAt).toEqual(AGORA);
    });

    it.each([OrderStatus.PROCESSED, OrderStatus.FAILED])(
      'recusa concluir um pedido que ja esta %s',
      (status) => {
        expect(() => pedidoNoStatus(status).markProcessed(AGORA)).toThrow(ConflictError);
      },
    );
  });

  describe('markFailed', () => {
    it('registra codigo, motivo e numero de tentativas', () => {
      const pedido = novoPedido();
      pedido.markFailed('INSUFFICIENT_STOCK', 'estoque insuficiente', 1);
      expect(pedido.status).toBe(OrderStatus.FAILED);
      expect(pedido.failureCode).toBe('INSUFFICIENT_STOCK');
      expect(pedido.failureReason).toBe('estoque insuficiente');
      expect(pedido.processingAttempts).toBe(1);
    });

    it('recusa falhar sem motivo escrito', () => {
      expect(() => novoPedido().markFailed('INSUFFICIENT_STOCK', '   ', 1)).toThrow(RangeError);
    });

    it('recusa falhar um pedido ja concluido', () => {
      expect(() =>
        pedidoNoStatus(OrderStatus.PROCESSED).markFailed('RETRIES_EXHAUSTED', 'x', 4),
      ).toThrow(ConflictError);
    });
  });

  describe('requeueForReprocessing', () => {
    it('devolve de FAILED para PENDING limpando o motivo', () => {
      const pedido = pedidoNoStatus(OrderStatus.FAILED);
      pedido.requeueForReprocessing();
      expect(pedido.status).toBe(OrderStatus.PENDING);
      expect(pedido.failureCode).toBeNull();
      expect(pedido.failureReason).toBeNull();
    });

    it.each([OrderStatus.PENDING, OrderStatus.PROCESSED])(
      'recusa reprocessar um pedido %s',
      (status) => {
        expect(() => pedidoNoStatus(status).requeueForReprocessing()).toThrow(ConflictError);
      },
    );
  });

});
