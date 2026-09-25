import { OrderItem } from '../../src/domain/order/order-item.entity';
import { Order } from '../../src/domain/order/order.entity';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { Money } from '../../src/domain/shared/money.vo';
import { OrderPresenter } from '../../src/interface/http/orders/order.presenter';

const pedido = (overrides: Partial<Parameters<typeof Order.restore>[0]> = {}): Order =>
  Order.restore({
    id: 'order-1',
    customerName: 'Ana Souza',
    createdBy: 'cliente@loja.test',
    status: OrderStatus.PENDING,
    total: Money.of('29.99'),
    items: [
      new OrderItem(1, 'Teclado', Money.of('10.00'), 2),
      new OrderItem(2, 'Mouse', Money.of('3.33'), 3),
    ],
    failureCode: null,
    failureReason: null,
    processingAttempts: 0,
    correlationId: 'corr-1',
    processedAt: null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides,
  });

describe('OrderPresenter', () => {
  it('expõe dinheiro como string decimal, nunca como número', () => {
    const resposta = OrderPresenter.toResponse(pedido());
    expect(resposta.total).toBe('29.99');
    expect(typeof resposta.total).toBe('string');
    expect(resposta.items[0]?.unitPrice).toBe('10.00');
    expect(resposta.items[1]?.lineTotal).toBe('9.99');
  });

  it('não vaza coluna interna', () => {
    const chaves = Object.keys(OrderPresenter.toResponse(pedido()));
    expect(chaves).not.toContain('processingAttempts');
    expect(chaves).not.toContain('updatedAt');
    expect(JSON.stringify(OrderPresenter.toResponse(pedido()))).not.toContain('passwordHash');
  });

  it('mostra o motivo quando o pedido falhou', () => {
    const resposta = OrderPresenter.toResponse(
      pedido({
        status: OrderStatus.FAILED,
        failureCode: 'INSUFFICIENT_STOCK',
        failureReason: 'estoque insuficiente',
      }),
    );
    expect(resposta.failureCode).toBe('INSUFFICIENT_STOCK');
    expect(resposta.failureReason).toBe('estoque insuficiente');
  });

  it('serializa datas em ISO e nulo quando não processado', () => {
    expect(OrderPresenter.toResponse(pedido()).createdAt).toBe('2026-01-01T10:00:00.000Z');
    expect(OrderPresenter.toResponse(pedido()).processedAt).toBeNull();
    expect(
      OrderPresenter.toResponse(pedido({ processedAt: new Date('2026-01-01T10:00:05.000Z') }))
        .processedAt,
    ).toBe('2026-01-01T10:00:05.000Z');
  });

  it('devolve o correlationId, que é o que o cliente cola no chamado', () => {
    expect(OrderPresenter.toResponse(pedido()).correlationId).toBe('corr-1');
  });
});
