import { ConflictError, FailureCode } from '../shared/errors';
import { Money } from '../shared/money.vo';
import { OrderItem } from './order-item.entity';
import { OrderStatus } from './order-status.enum';
import { calculateOrderTotal } from './order-total.calculator';

export interface OrderSnapshot {
  readonly id: string;
  readonly customerName: string;
  readonly status: OrderStatus;
  readonly total: Money;
  readonly items: readonly OrderItem[];
  readonly failureCode: FailureCode | null;
  readonly failureReason: string | null;
  readonly processingAttempts: number;
  readonly correlationId: string;
  readonly processedAt: Date | null;
  readonly createdAt: Date;
}

export class Order {
  private constructor(
    readonly id: string,
    readonly customerName: string,
    private currentStatus: OrderStatus,
    readonly total: Money,
    readonly items: readonly OrderItem[],
    private currentFailureCode: FailureCode | null,
    private currentFailureReason: string | null,
    private currentProcessingAttempts: number,
    readonly correlationId: string,
    private currentProcessedAt: Date | null,
    readonly createdAt: Date,
  ) {}

  static create(input: {
    id: string;
    customerName: string;
    items: readonly OrderItem[];
    correlationId: string;
    now: Date;
  }): Order {
    if (input.items.length === 0) {
      throw new RangeError('Pedido precisa de pelo menos um item');
    }
    if (input.customerName.trim() === '') {
      throw new RangeError('Pedido precisa de um nome de cliente');
    }
    return new Order(
      input.id,
      input.customerName,
      OrderStatus.PENDING,
      calculateOrderTotal(input.items),
      input.items,
      null,
      null,
      0,
      input.correlationId,
      null,
      input.now,
    );
  }

  static restore(snapshot: OrderSnapshot): Order {
    return new Order(
      snapshot.id,
      snapshot.customerName,
      snapshot.status,
      snapshot.total,
      snapshot.items,
      snapshot.failureCode,
      snapshot.failureReason,
      snapshot.processingAttempts,
      snapshot.correlationId,
      snapshot.processedAt,
      snapshot.createdAt,
    );
  }

  get status(): OrderStatus {
    return this.currentStatus;
  }

  get failureCode(): FailureCode | null {
    return this.currentFailureCode;
  }

  get failureReason(): string | null {
    return this.currentFailureReason;
  }

  get processingAttempts(): number {
    return this.currentProcessingAttempts;
  }

  get processedAt(): Date | null {
    return this.currentProcessedAt;
  }

  isPending(): boolean {
    return this.currentStatus === OrderStatus.PENDING;
  }

  markProcessed(at: Date): void {
    this.assertTransitionFrom(OrderStatus.PENDING, OrderStatus.PROCESSED);
    this.currentStatus = OrderStatus.PROCESSED;
    this.currentProcessedAt = at;
    this.currentFailureCode = null;
    this.currentFailureReason = null;
  }

  markFailed(code: FailureCode, reason: string, attempts: number): void {
    this.assertTransitionFrom(OrderStatus.PENDING, OrderStatus.FAILED);
    if (reason.trim() === '') {
      throw new RangeError('Pedido FAILED precisa de um motivo — sem motivo nao ha investigacao');
    }
    this.currentStatus = OrderStatus.FAILED;
    this.currentFailureCode = code;
    this.currentFailureReason = reason;
    this.currentProcessingAttempts = attempts;
  }

  requeueForReprocessing(): void {
    this.assertTransitionFrom(OrderStatus.FAILED, OrderStatus.PENDING);
    this.currentStatus = OrderStatus.PENDING;
    this.currentFailureCode = null;
    this.currentFailureReason = null;
    this.currentProcessedAt = null;
  }

  private assertTransitionFrom(expected: OrderStatus, to: OrderStatus): void {
    if (this.currentStatus !== expected) {
      throw new ConflictError(
        'INVALID_STATE_TRANSITION',
        `Transicao invalida: ${this.currentStatus} -> ${to} (esperado partir de ${expected})`,
      );
    }
  }
}
