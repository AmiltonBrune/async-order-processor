import { Money } from '../shared/money.vo';

export class Product {
  constructor(
    readonly id: number,
    readonly name: string,
    readonly price: Money,
    readonly stock: number,
  ) {
    if (!Number.isInteger(stock) || stock < 0) {
      throw new RangeError(`Estoque deve ser inteiro >= 0: ${stock}`);
    }
  }

  canFulfill(quantity: number): boolean {
    return quantity > 0 && this.stock >= quantity;
  }
}
