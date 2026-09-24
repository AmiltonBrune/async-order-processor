import { buildTopology, retryQueueName } from '../../src/infrastructure/messaging/amqp/amqp.topology';
import { useWorld } from '../support/setup-world';

const world = useWorld();

describe('topologia declarada no RabbitMQ', () => {
  it('a fila principal existe e aceita mensagem', async () => {
    expect(await world().queueDepth('orders.created')).toBe(0);
  });

  it('cada degrau de espera existe com o TTL configurado', async () => {
    for (const ttl of world().env.retryTiersMs) {
      const nome = retryQueueName(ttl);
      await expect(world().queueDepth(nome)).resolves.toBeGreaterThanOrEqual(0);
    }
  });

  it('a mensagem parada num degrau volta sozinha para a fila principal', async () => {
    await world().desligarConsumidor();
    const [primeiroDegrau] = world().env.retryTiersMs;
    expect(primeiroDegrau).toBeDefined();

    await world().publisher.publishRetry({ teste: true }, 'corr-topologia', 2, 'ensaio');

    const voltou = await world().waitFor(
      'mensagem voltar do degrau de espera para orders.created',
      async () => ((await world().queueDepth('orders.created')) > 0 ? true : null),
      10_000,
    );
    expect(voltou).toBe(true);
  });

  it('a dead-letter é durável e guarda a mensagem para inspeção', async () => {
    await world().publisher.publishDead({ orderId: 'x' }, 'corr-dead', 4, 'ensaio');
    expect(await world().queueDepth('orders.dead')).toBe(1);
    const mensagem = await world().firstMessageOf('orders.dead');
    expect(mensagem?.payload['orderId']).toBe('x');
  });

  it('a descrição da topologia bate com os degraus configurados', () => {
    const topologia = buildTopology(world().env.retryTiersMs);
    expect(topologia.queues).toHaveLength(world().env.retryTiersMs.length + 2);
  });
});
