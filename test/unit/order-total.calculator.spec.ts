import { OrderItem } from '../../src/domain/order/order-item.entity';
import { calculateOrderTotal } from '../../src/domain/order/order-total.calculator';
import { Money } from '../../src/domain/shared/money.vo';

const item = (preco: string, quantidade: number): OrderItem =>
  new OrderItem(1, 'Produto', Money.of(preco), quantidade);

describe('calculateOrderTotal', () => {
  it('soma as linhas do pedido do enunciado', () => {
    const total = calculateOrderTotal([item('10.00', 2), item('3.33', 3)]);
    expect(total.toFixed2()).toBe('29.99');
  });

  it('nao acumula erro de ponto flutuante em muitas linhas', () => {
    const itens = Array.from({ length: 10 }, () => item('0.10', 1));
    expect(calculateOrderTotal(itens).toFixed2()).toBe('1.00');
  });

  it('funciona com um unico item', () => {
    expect(calculateOrderTotal([item('19.99', 1)]).toFixed2()).toBe('19.99');
  });

  it('mantem a precisao no limite de DECIMAL(12,2)', () => {
    const total = calculateOrderTotal([item('4999999.99', 2)]);
    expect(total.toFixed2()).toBe('9999999.98');
  });

  it('recusa pedido sem item em vez de devolver zero', () => {
    expect(() => calculateOrderTotal([])).toThrow(RangeError);
  });
});
