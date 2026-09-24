import { DEAD_QUEUE, EVENTS_EXCHANGE, MAIN_QUEUE } from '../../src/infrastructure/messaging/messaging.constants';
import { buildTopology, retryQueueName, retryRoutingKey } from '../../src/infrastructure/messaging/amqp/amqp.topology';

describe('buildTopology', () => {
  const topologia = buildTopology([5_000, 15_000, 45_000]);
  const fila = (name: string) => topologia.queues.find((queue) => queue.name === name);

  it('declara a fila principal ligada ao exchange de eventos', () => {
    expect(fila(MAIN_QUEUE)).toMatchObject({
      exchange: EVENTS_EXCHANGE,
      routingKey: 'order.created',
    });
  });

  it('cria uma fila de espera por degrau de backoff', () => {
    expect(topologia.queues.map((queue) => queue.name)).toEqual([
      'orders.created',
      'orders.retry.5s',
      'orders.retry.15s',
      'orders.retry.45s',
      'orders.dead',
    ]);
  });

  it.each([
    ['orders.retry.5s', 5_000],
    ['orders.retry.15s', 15_000],
    ['orders.retry.45s', 45_000],
  ])('a fila %s espera %ims e devolve para a fila principal', (nome, ttl) => {
    expect(fila(nome)?.args).toEqual({
      'x-message-ttl': ttl,
      'x-dead-letter-exchange': EVENTS_EXCHANGE,
      'x-dead-letter-routing-key': 'order.created',
    });
  });

  it('cada degrau tem sua propria routing key por numero de tentativa', () => {
    expect(fila('orders.retry.5s')?.routingKey).toBe(retryRoutingKey(1));
    expect(fila('orders.retry.45s')?.routingKey).toBe(retryRoutingKey(3));
  });

  it('a dead-letter e durável e sem TTL — mensagem morta nao pode evaporar', () => {
    expect(fila(DEAD_QUEUE)?.args).toEqual({});
  });

  it('nomeia a fila pelo tempo legivel, inclusive com degraus curtos de teste', () => {
    expect(retryQueueName(5_000)).toBe('orders.retry.5s');
    expect(retryQueueName(200)).toBe('orders.retry.200ms');
    expect(buildTopology([200, 400]).queues.map((q) => q.name)).toContain('orders.retry.400ms');
  });

  it('declara os tres exchanges com os tipos certos', () => {
    expect(topologia.exchanges).toEqual([
      { name: 'orders.events', type: 'topic' },
      { name: 'orders.retry', type: 'direct' },
      { name: 'orders.dead', type: 'fanout' },
    ]);
  });
});
