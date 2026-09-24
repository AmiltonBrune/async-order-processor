import { InboxRepository } from './repositories/inbox.repository.port';
import { OrderRepository } from './repositories/order.repository.port';
import { OutboxRepository } from './repositories/outbox.repository.port';
import { ProductRepository } from './repositories/product.repository.port';
import { StockRepository } from './repositories/stock.repository.port';

export const UNIT_OF_WORK = Symbol('UnitOfWork');

export interface TransactionalRepositories {
  readonly orders: OrderRepository;
  readonly products: ProductRepository;
  readonly stock: StockRepository;
  readonly outbox: OutboxRepository;
  readonly inbox: InboxRepository;
}

export interface UnitOfWork {
  runInTransaction<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T>;
}
