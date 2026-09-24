import request from 'supertest';

import { MySqlProbe } from '../../src/infrastructure/persistence/health/mysql.probe';
import { useWorld } from '../support/setup-world';

const world = useWorld();

describe('health', () => {
  const http = () => request(world().httpServer as Parameters<typeof request>[0]);

  it('liveness responde sem tocar em dependência', async () => {
    const resposta = await http().get('/health/live');
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'ok' });
  });

  it('readiness confere MySQL e RabbitMQ e responde 200 com tudo de pé', async () => {
    const resposta = await http().get('/health/ready');
    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      status: 'ok',
      dependencies: [
        { name: 'mysql', up: true },
        { name: 'rabbitmq', up: true },
      ],
    });
  });

  it('a sonda do MySQL devolve falso quando a conexão não responde', async () => {
    const quebrada = {
      query: async (): Promise<never> => {
        throw new Error('ECONNREFUSED');
      },
    };
    const sonda = new MySqlProbe(quebrada as never);
    expect(await sonda.check()).toBe(false);
  });

  it('health é público: não exige token', async () => {
    expect((await http().get('/health/live')).status).toBe(200);
    expect((await http().get('/health/ready')).status).toBe(200);
  });
});
