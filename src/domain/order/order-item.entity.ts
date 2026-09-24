import { Money } from '../shared/money.vo';

export class OrderItem {
  constructor(
    readonly productId: number,
    readonly productName: string,
    readonly unitPrice: Money,
    readonly quantity: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError(`Quantidade do item deve ser inteiro >= 1: ${quantity}`);
    }
    if (unitPrice.isNegative()) {
      throw new RangeError(`Preco unitario nao pode ser negativo: ${unitPrice.toFixed2()}`);
    }
  }

  lineTotal(): Money {
    return this.unitPrice.times(this.quantity);
  }
}
