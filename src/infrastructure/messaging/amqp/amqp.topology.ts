import {
  DEAD_EXCHANGE,
  DEAD_LETTER_EXCHANGE_ARG,
  DEAD_LETTER_ROUTING_KEY_ARG,
  DEAD_QUEUE,
  EVENTS_EXCHANGE,
  MAIN_QUEUE,
  MESSAGE_TTL_ARG,
  ORDER_CREATED_ROUTING_KEY,
  RETRY_EXCHANGE,
} from '../messaging.constants';

export interface QueueDefinition {
  readonly name: string;
  readonly exchange: string;
  readonly routingKey: string;
  readonly args: Record<string, string | number>;
}

export interface TopologyDefinition {
  readonly exchanges: ReadonlyArray<{ name: string; type: 'topic' | 'direct' | 'fanout' }>;
  readonly queues: readonly QueueDefinition[];
}


export function buildTopology(retryTiersMs: readonly number[]): TopologyDefinition {
  return {
    exchanges: [
      { name: EVENTS_EXCHANGE, type: 'topic' },
      { name: RETRY_EXCHANGE, type: 'direct' },
      { name: DEAD_EXCHANGE, type: 'fanout' },
    ],
    queues: [
      { name: MAIN_QUEUE, exchange: EVENTS_EXCHANGE, routingKey: ORDER_CREATED_ROUTING_KEY, args: {} },
      ...retryTiersMs.map((ttl, index) => ({
        name: retryQueueName(ttl),
        exchange: RETRY_EXCHANGE,
        routingKey: retryRoutingKey(index + 1),
        args: {
          [MESSAGE_TTL_ARG]: ttl,
          [DEAD_LETTER_EXCHANGE_ARG]: EVENTS_EXCHANGE,
          [DEAD_LETTER_ROUTING_KEY_ARG]: ORDER_CREATED_ROUTING_KEY,
        },
      })),
      { name: DEAD_QUEUE, exchange: DEAD_EXCHANGE, routingKey: '', args: {} },
    ],
  };
}

export function retryQueueName(ttlMs: number): string {
  const label = ttlMs % 1_000 === 0 ? `${ttlMs / 1_000}s` : `${ttlMs}ms`;
  return `${RETRY_EXCHANGE}.${label}`;
}

/** A chave e o numero da retentativa: o degrau certo sem depender do TTL. */
export function retryRoutingKey(attempt: number): string {
  return `attempt.${attempt}`;
}
