import { StockReservation } from '../../src/domain/stock/stock-reservation.entity';

describe('StockReservation', () => {
  it('identifica a reserva pelo par pedido/produto', () => {
    const reserva = new StockReservation('order-1', 7, 2, new Date('2026-01-01T00:00:00Z'));
    expect(reserva.orderId).toBe('order-1');
    expect(reserva.productId).toBe(7);
    expect(reserva.quantity).toBe(2);
  });

  it.each([0, -1, 2.5])('recusa quantidade invalida: %s', (quantidade) => {
    expect(() => new StockReservation('order-1', 7, quantidade, new Date())).toThrow(RangeError);
  });

  // A fronteira exata importa: `< 1` recusa zero e aceita um. Um `<= 1` recusaria
  // toda reserva de uma unidade — o caso mais comum que existe.
  it('aceita a reserva de exatamente uma unidade', () => {
    const reserva = new StockReservation('order-1', 1, 1, new Date());
    expect(reserva.quantity).toBe(1);
  });

  it('recusa zero', () => {
    expect(() => new StockReservation('order-1', 1, 0, new Date())).toThrow(RangeError);
  });

});
