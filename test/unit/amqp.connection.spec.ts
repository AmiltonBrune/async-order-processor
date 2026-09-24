import { Env } from '../../src/infrastructure/config/env.schema';
import { AmqpConnection } from '../../src/infrastructure/messaging/amqp/amqp.connection';
import { OrderPublisher } from '../../src/infrastructure/messaging/orders/order.publisher';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';

jest.mock('amqplib', () => ({ connect: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const amqplib = require('amqplib') as { connect: jest.Mock };

type ChamadaDePublish = [string, string, Buffer, OpcoesDePublish, (erro: Error | null) => void];

interface OpcoesDePublish {
  persistent: boolean;
  headers: Record<string, unknown>;
}

const canalFalso = () => ({
  prefetch: jest.fn(async () => undefined),
  assertExchange: jest.fn(async () => undefined),
  assertQueue: jest.fn(async () => undefined),
  bindQueue: jest.fn(async () => undefined),
  close: jest.fn(async () => undefined),
  publish: jest.fn(
    (
      _e: string,
      _rk: string,
      _c: Buffer,
      _o: unknown,
      cb: (erro: Error | null) => void,
    ) => cb(null),
  ),
});

const conexaoFalsa = (canal: ReturnType<typeof canalFalso>) => {
  const handlers = new Map<string, (arg?: unknown) => void>();
  return {
    handlers,
    on: jest.fn((evento: string, cb: (arg?: unknown) => void) => handlers.set(evento, cb)),
    createConfirmChannel: jest.fn(async () => canal),
    close: jest.fn(async () => undefined),
  };
};

const ambiente = () =>
  ({ amqpUrl: 'amqp://localhost', prefetch: 10, retryTiersMs: [100, 200] }) as unknown as Env;

describe('AmqpConnection', () => {
  const logger = new StructuredLogger('silent', 'test');

  beforeEach(() => amqplib.connect.mockReset());

  it('declara a topologia inteira na primeira conexão e reusa o canal depois', async () => {
    const canal = canalFalso();
    amqplib.connect.mockResolvedValue(conexaoFalsa(canal));
    const amqp = new AmqpConnection(ambiente(), logger);

    const primeiro = await amqp.getChannel();
    const segundo = await amqp.getChannel();

    expect(primeiro).toBe(segundo);
    expect(amqplib.connect).toHaveBeenCalledTimes(1);
    expect(canal.prefetch).toHaveBeenCalledWith(10);
    expect(canal.assertExchange).toHaveBeenCalledTimes(3);
    expect(canal.assertQueue).toHaveBeenCalledTimes(4);
  });

  it('registra erro de conexão sem derrubar o processo', async () => {
    const canal = canalFalso();
    const conexao = conexaoFalsa(canal);
    amqplib.connect.mockResolvedValue(conexao);
    const registrar = jest.spyOn(logger, 'error');
    const amqp = new AmqpConnection(ambiente(), logger);
    await amqp.getChannel();

    conexao.handlers.get('error')?.(new Error('broker sumiu'));

    expect(registrar).toHaveBeenCalledWith('Conexao AMQP com erro', { erro: 'broker sumiu' });
    registrar.mockRestore();
  });

  it('ao fechar a conexão, a próxima chamada reconecta sozinha', async () => {
    const canal = canalFalso();
    const conexao = conexaoFalsa(canal);
    amqplib.connect.mockResolvedValue(conexao);
    const amqp = new AmqpConnection(ambiente(), logger);
    await amqp.getChannel();

    conexao.handlers.get('close')?.();
    await amqp.getChannel();

    expect(amqplib.connect).toHaveBeenCalledTimes(2);
  });

  it('shutdown fecha canal e conexão', async () => {
    const canal = canalFalso();
    const conexao = conexaoFalsa(canal);
    amqplib.connect.mockResolvedValue(conexao);
    const amqp = new AmqpConnection(ambiente(), logger);
    await amqp.getChannel();

    await amqp.onApplicationShutdown();

    expect(canal.close).toHaveBeenCalled();
    expect(conexao.close).toHaveBeenCalled();
  });

  it('shutdown com canal já fechado não quebra o encerramento', async () => {
    const canal = canalFalso();
    canal.close.mockRejectedValue(new Error('canal ja fechado'));
    amqplib.connect.mockResolvedValue(conexaoFalsa(canal));
    const amqp = new AmqpConnection(ambiente(), logger);
    await amqp.getChannel();

    await expect(amqp.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('shutdown sem nunca ter conectado é inofensivo', async () => {
    await expect(new AmqpConnection(ambiente(), logger).onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe('OrderPublisher', () => {
  const logger = new StructuredLogger('silent', 'test');

  beforeEach(() => amqplib.connect.mockReset());

  it('resolve só depois do publisher confirm do broker', async () => {
    const canal = canalFalso();
    amqplib.connect.mockResolvedValue(conexaoFalsa(canal));
    const publisher = new OrderPublisher(new AmqpConnection(ambiente(), logger));

    await publisher.publishCreated({ orderId: 'o1' }, 'corr-1');

    const [exchange, routingKey, , opcoes] = canal.publish.mock.calls[0] as unknown as ChamadaDePublish;
    expect(exchange).toBe('orders.events');
    expect(routingKey).toBe('order.created');
    expect(opcoes.persistent).toBe(true);
    expect(opcoes.headers['x-correlation-id']).toBe('corr-1');
  });

  it('propaga a falha quando o broker recusa a confirmação', async () => {
    const canal = canalFalso();
    canal.publish.mockImplementation(
      (_e, _rk, _c, _o, cb: (erro: Error | null) => void) => cb(new Error('nack do broker')),
    );
    amqplib.connect.mockResolvedValue(conexaoFalsa(canal));
    const publisher = new OrderPublisher(new AmqpConnection(ambiente(), logger));

    await expect(publisher.publishCreated({ orderId: 'o1' }, 'corr-1')).rejects.toThrow('nack do broker');
  });

  it('a retentativa vai para o degrau correspondente à tentativa', async () => {
    const canal = canalFalso();
    amqplib.connect.mockResolvedValue(conexaoFalsa(canal));
    const publisher = new OrderPublisher(new AmqpConnection(ambiente(), logger));

    await publisher.publishRetry({ orderId: 'o1' }, 'corr-1', 3, 'deadlock');

    const [exchange, routingKey, , opcoes] = canal.publish.mock.calls[0] as unknown as ChamadaDePublish;
    expect(exchange).toBe('orders.retry');
    expect(routingKey).toBe('attempt.2');
    expect(opcoes.headers['x-attempt']).toBe(3);
    expect(opcoes.headers['x-death-reason']).toBe('deadlock');
  });

  it('a dead-letter usa o exchange fanout, sem routing key', async () => {
    const canal = canalFalso();
    amqplib.connect.mockResolvedValue(conexaoFalsa(canal));
    const publisher = new OrderPublisher(new AmqpConnection(ambiente(), logger));

    await publisher.publishDead({ orderId: 'o1' }, 'corr-1', 4, 'esgotou');

    const [exchange, routingKey] = canal.publish.mock.calls[0] as unknown as ChamadaDePublish;
    expect(exchange).toBe('orders.dead');
    expect(routingKey).toBe('');
  });
});
