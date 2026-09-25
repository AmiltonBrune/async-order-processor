import { OrderCreatedEvent } from '../../src/domain/order/events/order-created.event';
import { OrderItem } from '../../src/domain/order/order-item.entity';
import { Order } from '../../src/domain/order/order.entity';
import { OrderStatus } from '../../src/domain/order/order-status.enum';
import { Product } from '../../src/domain/product/product.entity';
import { User } from '../../src/domain/user/user.entity';
import { UserRole } from '../../src/domain/user/user-role.enum';
import { Page } from '../../src/domain/ports/pagination.port';
import { InboxRepository } from '../../src/domain/ports/repositories/inbox.repository.port';
import { ListOrdersFilter, OrderRepository } from '../../src/domain/ports/repositories/order.repository.port';
import { OutboxRepository } from '../../src/domain/ports/repositories/outbox.repository.port';
import { ProductRepository } from '../../src/domain/ports/repositories/product.repository.port';
import { StockRepository } from '../../src/domain/ports/repositories/stock.repository.port';
import { UserRepository } from '../../src/domain/ports/repositories/user.repository.port';
import {
  TransactionalRepositories,
  UnitOfWork,
} from '../../src/domain/ports/unit-of-work.port';
import { AccessToken } from '../../src/domain/ports/system/access-token.port';
import { Clock } from '../../src/domain/ports/system/clock.port';
import { IdGenerator } from '../../src/domain/ports/system/id-generator.port';
import { PasswordHasher } from '../../src/domain/ports/system/password-hasher.port';
import { TokenIssuer } from '../../src/domain/ports/system/token-issuer.port';
import { Money } from '../../src/domain/shared/money.vo';

interface ProductRow {
  id: number;
  name: string;
  price: string;
  stock: number;
}

interface OrderRow {
  id: string;
  customerName: string;
  createdBy: string;
  status: OrderStatus;
  total: string;
  items: Array<{ productId: number; productName: string; unitPrice: string; quantity: number }>;
  failureCode: string | null;
  failureReason: string | null;
  processingAttempts: number;
  correlationId: string;
  processedAt: string | null;
  createdAt: string;
}

interface ReservationRow {
  orderId: string;
  productId: number;
  quantity: number;
}

export class InMemoryDatabase {
  products: ProductRow[] = [];
  orders: OrderRow[] = [];
  reservations: ReservationRow[] = [];
  outbox: Array<{ eventId: string; orderId: string; correlationId: string }> = [];
  inbox: Array<{ consumer: string; eventId: string }> = [];
  users: User[] = [];

  static withCatalog(...produtos: Array<[string, number]>): InMemoryDatabase {
    const db = new InMemoryDatabase();
    produtos.forEach(([name, stock], index) => {
      db.products.push({ id: index + 1, name, price: '10.00', stock });
    });
    return db;
  }

  stockOf(name: string): number {
    return this.products.find((product) => product.name === name)?.stock ?? -1;
  }

  orderById(id: string): OrderRow {
    const row = this.orders.find((order) => order.id === id);
    if (row === undefined) throw new Error(`Pedido ausente no dublê: ${id}`);
    return row;
  }

  seedUser(email: string, passwordHash: string, role: UserRole): User {
    const user = new User(`user-${this.users.length + 1}`, email, passwordHash, role);
    this.users.push(user);
    return user;
  }

  seedOrder(overrides: Partial<OrderRow> & { id: string }): OrderRow {
    const row: OrderRow = {
      customerName: 'Ana Souza',
      createdBy: 'cliente@loja.test',
      status: OrderStatus.PENDING,
      total: '20.00',
      items: [{ productId: 1, productName: 'Teclado', unitPrice: '10.00', quantity: 2 }],
      failureCode: null,
      failureReason: null,
      processingAttempts: 0,
      correlationId: 'corr-1',
      processedAt: null,
      createdAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
      ...overrides,
    };
    this.orders.push(row);
    return row;
  }

  snapshot(): string {
    return JSON.stringify({
      products: this.products,
      orders: this.orders,
      reservations: this.reservations,
      outbox: this.outbox,
      inbox: this.inbox,
    });
  }

  restore(snapshot: string): void {
    const state = JSON.parse(snapshot) as Pick<
      InMemoryDatabase,
      'products' | 'orders' | 'reservations' | 'outbox' | 'inbox'
    >;
    this.products = state.products;
    this.orders = state.orders;
    this.reservations = state.reservations;
    this.outbox = state.outbox;
    this.inbox = state.inbox;
  }
}

const toOrder = (row: OrderRow): Order =>
  Order.restore({
    id: row.id,
    customerName: row.customerName,
    createdBy: row.createdBy,
    status: row.status,
    total: Money.of(row.total),
    items: row.items.map(
      (item) =>
        new OrderItem(item.productId, item.productName, Money.of(item.unitPrice), item.quantity),
    ),
    failureCode: row.failureCode as never,
    failureReason: row.failureReason,
    processingAttempts: row.processingAttempts,
    correlationId: row.correlationId,
    processedAt: row.processedAt === null ? null : new Date(row.processedAt),
    createdAt: new Date(row.createdAt),
  });

export class InMemoryOrderRepository implements OrderRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async insert(order: Order): Promise<void> {
    this.db.orders.push({
      id: order.id,
      customerName: order.customerName,
      createdBy: order.createdBy,
      status: order.status,
      total: order.total.toFixed2(),
      items: order.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unitPrice: item.unitPrice.toFixed2(),
        quantity: item.quantity,
      })),
      failureCode: order.failureCode,
      failureReason: order.failureReason,
      processingAttempts: order.processingAttempts,
      correlationId: order.correlationId,
      processedAt: null,
      createdAt: order.createdAt.toISOString(),
    });
  }

  async findById(id: string): Promise<Order | null> {
    const row = this.db.orders.find((order) => order.id === id);
    return row === undefined ? null : toOrder(row);
  }

  async list(filter: ListOrdersFilter): Promise<Page<Order>> {
    const matching = this.db.orders.filter(
      (order) =>
        (filter.status === undefined || order.status === filter.status) &&
        (filter.createdBy === undefined || order.createdBy === filter.createdBy),
    );
    const offset = (filter.page - 1) * filter.limit;
    return {
      data: matching.slice(offset, offset + filter.limit).map(toOrder),
      total: matching.length,
    };
  }

  /** Espelha `UPDATE ... WHERE id = ? AND status = ?` e a checagem de affectedRows. */
  async transitionStatus(order: Order, from: OrderStatus): Promise<boolean> {
    const row = this.db.orders.find((candidate) => candidate.id === order.id);
    if (row === undefined || row.status !== from) return false;
    row.status = order.status;
    row.failureCode = order.failureCode;
    row.failureReason = order.failureReason;
    row.processingAttempts = order.processingAttempts;
    row.processedAt = order.processedAt === null ? null : order.processedAt.toISOString();
    return true;
  }
}

export class InMemoryProductRepository implements ProductRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async findByNames(names: readonly string[]): Promise<readonly Product[]> {
    return this.db.products
      .filter((product) => names.includes(product.name))
      .map((product) => new Product(product.id, product.name, Money.of(product.price), product.stock));
  }

  /** Espelha `UPDATE products SET stock = stock - :q WHERE id = :id AND stock >= :q`. */
  async decrementStock(productId: number, quantity: number): Promise<boolean> {
    const row = this.db.products.find((product) => product.id === productId);
    if (row === undefined || row.stock < quantity) return false;
    row.stock -= quantity;
    return true;
  }
}

export class InMemoryStockRepository implements StockRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  /** Espelha a violacao de UNIQUE(order_id, product_id). */
  async reserve(orderId: string, productId: number, quantity: number): Promise<boolean> {
    const exists = this.db.reservations.some(
      (reservation) => reservation.orderId === orderId && reservation.productId === productId,
    );
    if (exists) return false;
    this.db.reservations.push({ orderId, productId, quantity });
    return true;
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async append(event: OrderCreatedEvent): Promise<void> {
    this.db.outbox.push({
      eventId: event.eventId,
      orderId: event.orderId,
      correlationId: event.correlationId,
    });
  }
}

export class InMemoryInboxRepository implements InboxRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  /** Espelha a PK (consumer, event_id). */
  async register(consumer: string, eventId: string): Promise<boolean> {
    const seen = this.db.inbox.some(
      (entry) => entry.consumer === consumer && entry.eventId === eventId,
    );
    if (seen) return false;
    this.db.inbox.push({ consumer, eventId });
    return true;
  }
}

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.db.users.find((user) => user.email === email) ?? null;
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  /** Quantas transacoes foram abertas — usado para provar que sao a MESMA. */
  transactions = 0;

  constructor(private readonly db: InMemoryDatabase) {}

  async runInTransaction<T>(work: (repositories: TransactionalRepositories) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const snapshot = this.db.snapshot();
    try {
      return await work({
        orders: new InMemoryOrderRepository(this.db),
        products: new InMemoryProductRepository(this.db),
        stock: new InMemoryStockRepository(this.db),
        outbox: new InMemoryOutboxRepository(this.db),
        inbox: new InMemoryInboxRepository(this.db),
      });
    } catch (error) {
      this.db.restore(snapshot);
      throw error;
    }
  }
}

export class FixedClock implements Clock {
  constructor(private readonly instant = new Date('2026-01-01T10:00:00.000Z')) {}
  now(): Date {
    return new Date(this.instant);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;
  next(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

export class FakePasswordHasher implements PasswordHasher {
  calls: string[] = [];
  async hash(plain: string): Promise<string> {
    return `hash:${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    this.calls.push(hash);
    return hash === `hash:${plain}`;
  }
}

export class FakeTokenIssuer implements TokenIssuer {
  issued: Array<{ subject: string; role: string }> = [];
  async issue(subject: string, role: string): Promise<AccessToken> {
    this.issued.push({ subject, role });
    return { accessToken: `token-${subject}-${role}`, expiresIn: 3600 };
  }
}
