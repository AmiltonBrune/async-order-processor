import { INestApplication } from '@nestjs/common';

import { iniciarPapel } from '../../src/main';
import { Env } from '../../src/infrastructure/config/env.schema';
import { StructuredLogger } from '../../src/infrastructure/observability/pino.logger';
import { ConsumerWorker } from '../../src/workers/consumer/consumer.worker';
import { RelayWorker } from '../../src/workers/relay/relay.worker';

const aplicacaoFalsa = () => {
  const relay = { start: jest.fn() };
  const consumer = { start: jest.fn(async () => undefined) };
  const app = {
    init: jest.fn(async () => undefined),
    listen: jest.fn(async () => undefined),
    useGlobalPipes: jest.fn(),
    get: jest.fn((token: unknown) => {
      if (token === RelayWorker) return relay;
      if (token === ConsumerWorker) return consumer;
      return undefined;
    }),
  };
  return { app: app as unknown as INestApplication, relay, consumer };
};

const ambiente = (appRole: string): Env => ({ appRole, httpPort: 3000 }) as unknown as Env;
const logger = new StructuredLogger('silent', 'test');

const iniciarApi = jest.fn(async () => undefined);

beforeEach(() => iniciarApi.mockClear());

describe('iniciarPapel', () => {
  it('no papel relay, inicia o relay e NÃO o consumidor', async () => {
    const { app, relay, consumer } = aplicacaoFalsa();
    await iniciarPapel(app, ambiente('relay'), logger, iniciarApi);
    expect(relay.start).toHaveBeenCalledTimes(1);
    expect(consumer.start).not.toHaveBeenCalled();
    expect(iniciarApi).not.toHaveBeenCalled();
  });

  it('no papel consumer, inicia o consumidor e NÃO o relay', async () => {
    const { app, relay, consumer } = aplicacaoFalsa();
    await iniciarPapel(app, ambiente('consumer'), logger, iniciarApi);
    expect(consumer.start).toHaveBeenCalledTimes(1);
    expect(relay.start).not.toHaveBeenCalled();
  });

  it('no papel api, sobe a API e nenhum worker', async () => {
    const { app, relay, consumer } = aplicacaoFalsa();
    await iniciarPapel(app, ambiente('api'), logger, iniciarApi);
    expect(iniciarApi).toHaveBeenCalledTimes(1);
    expect(relay.start).not.toHaveBeenCalled();
    expect(consumer.start).not.toHaveBeenCalled();
  });

  it('papel desconhecido derruba a subida em vez de virar api por engano', async () => {
    const { app } = aplicacaoFalsa();
    await expect(iniciarPapel(app, ambiente('worker'), logger, iniciarApi)).rejects.toThrow(
      'Papel desconhecido: worker',
    );
  });
});

describe('bootstrap', () => {
  it('cria a aplicação, liga o logger e os hooks de shutdown', async () => {
    jest.resetModules();
    const registrado = new StructuredLogger('silent', 'test');
    const relay = { start: jest.fn() };
    const app = {
      get: jest.fn((token: unknown) => {
        if (String(token) === 'Symbol(Env)') return { appRole: 'relay' };
        if (String(token) === 'Symbol(Logger)') return registrado;
        return relay;
      }),
      useLogger: jest.fn(),
      enableShutdownHooks: jest.fn(),
      init: jest.fn(async () => undefined),
      listen: jest.fn(async () => undefined),
    };
    jest.doMock('@nestjs/core', () => ({
      NestFactory: { create: jest.fn(async () => app) },
      APP_FILTER: 'APP_FILTER',
      APP_GUARD: 'APP_GUARD',
      APP_INTERCEPTOR: 'APP_INTERCEPTOR',
      Reflector: class {},
    }));

    const modulo = await import('../../src/main');
    await (modulo as unknown as { bootstrap: () => Promise<void> }).bootstrap();

    expect(app.useLogger).toHaveBeenCalledWith(registrado);
    expect(app.enableShutdownHooks).toHaveBeenCalled();
    expect(relay.start).toHaveBeenCalled();
    // O relay também escuta HTTP: é onde `/metrics` publica a gauge da outbox.
    expect(app.listen).toHaveBeenCalled();
    jest.dontMock('@nestjs/core');
    jest.resetModules();
  });
});

describe('startApi', () => {
  it('monta validação, Swagger e abre a porta configurada', async () => {
    const { startApi } = await import('../../src/main');
    const usados: unknown[] = [];
    const app = {
      useGlobalPipes: jest.fn((pipe: unknown) => usados.push(pipe)),
      listen: jest.fn(async () => undefined),
      getHttpAdapter: () => ({ getType: () => 'express' }),
      get: jest.fn(),
    };
    const swagger = jest.spyOn(
      await import('../../src/interface/http/docs/swagger.setup'),
      'setupSwagger',
    ).mockImplementation(() => undefined);

    await startApi(app as never, { httpPort: 4321 } as never, new StructuredLogger('silent', 'test'));

    expect(usados).toHaveLength(1);
    expect(swagger).toHaveBeenCalledWith(app);
    expect(app.listen).toHaveBeenCalledWith(4321);
    swagger.mockRestore();
  });
});
