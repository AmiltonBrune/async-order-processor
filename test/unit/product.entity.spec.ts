import { Product } from '../../src/domain/product/product.entity';
import { Money } from '../../src/domain/shared/money.vo';

const produto = (estoque: number): Product =>
  new Product(1, 'Teclado', Money.of('10.00'), estoque);

describe('Product', () => {
  it.each([
    [5, 5, true],
    [5, 4, true],
    [5, 6, false],
    [0, 1, false],
  ])('com estoque %i, canFulfill(%i) e %s', (estoque, pedido, esperado) => {
    expect(produto(estoque).canFulfill(pedido)).toBe(esperado);
  });

  it('recusa quantidade nao positiva', () => {
    expect(produto(5).canFulfill(0)).toBe(false);
    expect(produto(5).canFulfill(-1)).toBe(false);
  });

  it('recusa construir produto com estoque negativo', () => {
    expect(() => produto(-1)).toThrow(RangeError);
    expect(() => new Product(1, 'Teclado', Money.of('10.00'), 1.5)).toThrow(RangeError);
  });
});
