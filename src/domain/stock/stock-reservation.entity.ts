export class StockReservation {
  constructor(
    readonly orderId: string,
    readonly productId: number,
    readonly quantity: number,
    readonly reservedAt: Date,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError(`Quantidade reservada deve ser inteiro >= 1: ${quantity}`);
    }
  }
}
