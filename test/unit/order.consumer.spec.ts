import { ConsumeMessage } from 'amqplib';

import { OrderCreatedEvent } from '../../src/domain/order/events/order-created.event';
import { BusinessRuleViolation, TransientError } from '../../src/domain/shared/errors';
import { Env } from '../../src/infrastructure/config/env.schema';
import { OrderConsumer } from '../../src/infrastructure/messaging/orders/order.consumer';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';

const montar = (opcoes: { tiers?: number[] } = {}) => {
  const canal = {
    ack: jest.fn(),
    consume: jest.fn(async (_fila: string, cb: (m: ConsumeMessage | null) => void) => {
      canal.entregar = cb;
      return { consumerTag: 'tag-1' };
    }),
    cancel: jest.fn(async () => undefined),
    entregar: (_m: ConsumeMessage | null): void => undefined,
  };
  const publisher = {
    publishRetry: jest.fn(async () => undefined),
    publishDead: jest.fn(async () => undefined),
  };
  const processOrder = {
    execute: jest.fn(async () => 'PROCESSED' as const),
    failOrder: jest.fn(async () => true),
  };
  const env = {
    consumerName: 'order-processor',
    prefetch: 10,
    retryTiersMs: opcoes.tiers ?? [100, 200, 300],
  } as unknown as Env;

  const consumer = new OrderConsumer(
    { getChannel: async () => canal } as never,
    publisher as never,
    processOrder as never,
    env,
    new StructuredLogger('silent', 'test'),
  );
  return { canal, publisher, processOrder, consumer };
};

const mensagem = (payload: unknown, headers?: Record<string, unknown>): ConsumeMessage =>
  ({
    content: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    properties: headers === undefined ? {} : { headers },
    fields: {},
  }) as unknown as ConsumeMessage;

const eventoValido = () =>
  new OrderCreatedEvent('evt-1', 'order-1', 'corr-1', new Date('2026-01-01T10:00:00Z')).toPayload();

const drenar = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

describe('OrderConsumer', () => {
  it('confirma a mensagem quando o processamento conclui', async () => {
    const { consumer, canal, publisher } = montar();
    await consumer.start();

    canal.entregar(mensagem(eventoValido()));
    await drenar();

    expect(canal.ack).toHaveBeenCalledTimes(1);
    expect(publisher.publishRetry).not.toHaveBeenCalled();
    expect(publisher.publishDead).not.toHaveBeenCalled();
  });

  it('ignora a entrega nula que o amqplib manda ao cancelar o consumo', async () => {
    const { consumer, canal } = montar();
    await consumer.start();

    canal.entregar(null);
    await drenar();

    expect(canal.ack).not.toHaveBeenCalled();
  });

  it('mensagem ilegível vai direto para a dead-letter, sem retentativa', async () => {
    const { consumer, canal, publisher } = montar();
    await consumer.start();

    canal.entregar(mensagem('{ isto nao e json'));
    await drenar();

    expect(publisher.publishDead).toHaveBeenCalledTimes(1);
    expect(publisher.publishRetry).not.toHaveBeenCalled();
    expect(canal.ack).toHaveBeenCalledTimes(1);
  });

  it('evento sem pedido correspondente vai para a dead-letter com log', async () => {
    const { consumer, canal, publisher, processOrder } = montar();
    processOrder.execute.mockResolvedValueOnce('DEAD_LETTER' as never);
    await consumer.start();

    canal.entregar(mensagem(eventoValido()));
    await drenar();

    expect(publisher.publishDead).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' }),
      'corr-1',
      1,
      expect.stringContaining('inexistente'),
    );
    expect(canal.ack).toHaveBeenCalledTimes(1);
  });

  it('erro transitório vira retentativa no degrau seguinte', async () => {
    const { consumer, canal, publisher, processOrder } = montar();
    processOrder.execute.mockRejectedValue(new TransientError('broker reiniciando'));
    await consumer.start();

    canal.entregar(mensagem(eventoValido(), { 'x-attempt': 2 }));
    await drenar();

    expect(publisher.publishRetry).toHaveBeenCalledWith(
      expect.anything(),
      'corr-1',
      3,
      'broker reiniciando',
    );
    expect(publisher.publishDead).not.toHaveBeenCalled();
    expect(canal.ack).toHaveBeenCalledTimes(1);
  });

  it('esgotadas as tentativas, marca o pedido FAILED e manda para a dead-letter', async () => {
    const { consumer, canal, publisher, processOrder } = montar();
    processOrder.execute.mockRejectedValue(new TransientError('nunca passa'));
    await consumer.start();

    canal.entregar(mensagem(eventoValido(), { 'x-attempt': 4 }));
    await drenar();

    expect(processOrder.failOrder).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', attempt: 4 }),
      expect.objectContaining({ code: 'RETRIES_EXHAUSTED', message: 'nunca passa' }),
    );
    expect(publisher.publishDead).toHaveBeenCalledTimes(1);
    expect(publisher.publishRetry).not.toHaveBeenCalled();
  });

  it('sem orderId no payload, não tenta marcar pedido nenhum', async () => {
    const { consumer, canal, publisher, processOrder } = montar();
    processOrder.execute.mockRejectedValue(new TransientError('x'));
    await consumer.start();

    canal.entregar(mensagem({ ...eventoValido(), orderId: 42 }, { 'x-attempt': 4 }));
    await drenar();

    expect(processOrder.failOrder).not.toHaveBeenCalled();
    expect(publisher.publishDead).toHaveBeenCalledTimes(1);
  });

  it('erro de negócio escapando do caso de uso não é retentado', async () => {
    const { consumer, canal, publisher, processOrder } = montar();
    processOrder.execute.mockRejectedValue(
      new BusinessRuleViolation('MALFORMED_EVENT', 'payload quebrado'),
    );
    await consumer.start();

    canal.entregar(mensagem(eventoValido()));
    await drenar();

    expect(publisher.publishRetry).not.toHaveBeenCalled();
    expect(publisher.publishDead).toHaveBeenCalledTimes(1);
    expect(canal.ack).toHaveBeenCalledTimes(1);
  });

  it('mensagem sem headers é tratada como primeira tentativa', async () => {
    const { consumer, canal, publisher, processOrder } = montar();
    processOrder.execute.mockRejectedValue(new TransientError('falha'));
    await consumer.start();

    canal.entregar(mensagem(eventoValido()));
    await drenar();

    expect(publisher.publishRetry).toHaveBeenCalledWith(expect.anything(), 'corr-1', 2, 'falha');
  });

  it('payload sem eventId ainda marca o pedido FAILED', async () => {
    const { consumer, canal, processOrder } = montar();
    processOrder.execute.mockRejectedValue(new TransientError('nunca passa'));
    await consumer.start();

    const { eventId: _ignorado, ...semEventId } = eventoValido();
    canal.entregar(mensagem({ ...semEventId, eventId: 'evt-1' }, { 'x-attempt': 4 }));
    await drenar();

    expect(processOrder.failOrder).toHaveBeenCalled();
  });

  it('parar sem ter iniciado não quebra', async () => {
    const { consumer, canal } = montar();
    await expect(consumer.stop()).resolves.toBeUndefined();
    expect(canal.cancel).not.toHaveBeenCalled();
  });

  it('parar cancela o consumo e espera o que está em voo', async () => {
    const { consumer, canal } = montar();
    await consumer.start();
    await consumer.stop();
    expect(canal.cancel).toHaveBeenCalledWith('tag-1');
  });
});
