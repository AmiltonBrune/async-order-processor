import { OrderItem } from '../../src/domain/order/order-item.entity';
import { Money } from '../../src/domain/shared/money.vo';

describe('OrderItem', () => {
  it('calcula o total da linha como preco unitario vezes quantidade', () => {
    const item = new OrderItem(1, 'Teclado', Money.of('10.00'), 2);
    expect(item.lineTotal().toFixed2()).toBe('20.00');
  });

  it('guarda o snapshot do nome e do preco no momento do pedido', () => {
    const item = new OrderItem(1, 'Teclado Antigo', Money.of('10.00'), 1);
    expect(item.productName).toBe('Teclado Antigo');
    expect(item.unitPrice.toFixed2()).toBe('10.00');
  });

  it.each([0, -1, 1.5, Number.NaN])('recusa quantidade invalida: %s', (quantidade) => {
    expect(() => new OrderItem(1, 'Teclado', Money.of('10.00'), quantidade)).toThrow(RangeError);
  });

  it('recusa preco unitario negativo', () => {
    expect(() => new OrderItem(1, 'Teclado', Money.of('-1.00'), 1)).toThrow(RangeError);
  });
});
