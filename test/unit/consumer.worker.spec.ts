import { ConsumerWorker } from '../../src/workers/consumer/consumer.worker';

describe('ConsumerWorker', () => {
  it('iniciar delega ao consumidor', async () => {
    const consumer = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) };
    await new ConsumerWorker(consumer as never).start();
    expect(consumer.start).toHaveBeenCalledTimes(1);
  });

  it('o shutdown do Nest para o consumo e espera o que está em voo', async () => {
    const consumer = { start: jest.fn(async () => undefined), stop: jest.fn(async () => undefined) };
    await new ConsumerWorker(consumer as never).onApplicationShutdown();
    expect(consumer.stop).toHaveBeenCalledTimes(1);
  });
});
