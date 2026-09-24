import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface CorrelationStore {
  readonly correlationId: string;
  orderId?: string;
}

export class CorrelationContext {
  private static readonly storage = new AsyncLocalStorage<CorrelationStore>();

  static run<T>(correlationId: string, work: () => T): T {
    return CorrelationContext.storage.run({ correlationId }, work);
  }

  static current(): string | undefined {
    return CorrelationContext.storage.getStore()?.correlationId;
  }

  static attachOrderId(orderId: string): void {
    const store = CorrelationContext.storage.getStore();
    if (store !== undefined) store.orderId = orderId;
  }

  static currentOrderId(): string | undefined {
    return CorrelationContext.storage.getStore()?.orderId;
  }

  static resolve(incoming: unknown): string {
    return typeof incoming === 'string' && incoming.trim() !== '' ? incoming.trim() : randomUUID();
  }
}
