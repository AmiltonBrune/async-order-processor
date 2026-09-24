import { Money } from '../shared/money.vo';
import { OrderItem } from './order-item.entity';

export function calculateOrderTotal(items: readonly OrderItem[]): Money {
  const [first] = items;
  if (first === undefined) {
    throw new RangeError('Pedido precisa de pelo menos um item para ter total');
  }
  return items
    .slice(1)
    .reduce((total, item) => total.plus(item.lineTotal()), first.lineTotal());
}
