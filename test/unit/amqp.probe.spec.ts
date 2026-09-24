import { AmqpProbe } from '../../src/infrastructure/messaging/amqp/amqp.probe';

describe('AmqpProbe', () => {
  it('devolve true com o canal disponível', async () => {
    const sonda = new AmqpProbe({ getChannel: async () => ({}) } as never);
    expect(sonda.name).toBe('rabbitmq');
    await expect(sonda.check()).resolves.toBe(true);
  });

  it('devolve false — e não lança — com o broker fora', async () => {
    const sonda = new AmqpProbe({
      getChannel: async () => {
        throw new Error('ECONNREFUSED');
      },
    } as never);
    await expect(sonda.check()).resolves.toBe(false);
  });
});
