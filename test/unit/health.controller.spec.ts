import { ReadinessProbe } from '../../src/domain/ports/system/readiness-probe.port';
import { HealthController } from '../../src/interface/http/health/health.controller';

const resposta = () => {
  let statusRecebido = 0;
  let corpoRecebido: unknown = null;
  return {
    status: (code: number) => {
      statusRecebido = code;
      return { json: (body: unknown) => { corpoRecebido = body; } };
    },
    lido: () => ({ status: statusRecebido, corpo: corpoRecebido }),
  };
};

const sonda = (name: string, up: boolean): ReadinessProbe => ({ name, check: async () => up });

describe('HealthController', () => {
  it('liveness responde sem consultar dependência nenhuma', async () => {
    const sondaEspia = { name: 'mysql', check: jest.fn(async () => true) };
    expect(new HealthController([sondaEspia]).live()).toEqual({ status: 'ok' });
    expect(sondaEspia.check).not.toHaveBeenCalled();
  });

  it('readiness responde 200 com todas as dependências de pé', async () => {
    const r = resposta();
    await new HealthController([sonda('mysql', true), sonda('rabbitmq', true)]).ready(r);
    expect(r.lido()).toEqual({
      status: 200,
      corpo: {
        status: 'ok',
        dependencies: [
          { name: 'mysql', up: true },
          { name: 'rabbitmq', up: true },
        ],
      },
    });
  });

  it('readiness responde 503 quando UMA dependência está fora', async () => {
    const r = resposta();
    await new HealthController([sonda('mysql', true), sonda('rabbitmq', false)]).ready(r);
    expect(r.lido().status).toBe(503);
    expect(r.lido().corpo).toMatchObject({ status: 'degraded' });
  });

  it('readiness sem sonda nenhuma responde 200', async () => {
    const r = resposta();
    await new HealthController([]).ready(r);
    expect(r.lido().status).toBe(200);
  });
});
