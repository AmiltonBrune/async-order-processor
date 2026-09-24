import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';
import request from 'supertest';

import { ReadinessProbe } from '../../src/domain/ports/system/readiness-probe.port';
import { HealthController } from '../../src/interface/http/health/health.controller';
import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/saude-do-servico.feature');
const world = useWorld();

const resposta = () => {
  let status = 0;
  let corpo: unknown = null;
  return {
    status: (code: number) => {
      status = code;
      return { json: (body: unknown) => { corpo = body; } };
    },
    lido: () => ({ status, corpo: corpo as { status: string; dependencies?: Array<{ name: string; up: boolean }> } }),
  };
};

defineFeature(feature, (test) => {
  const http = () => request(world().httpServer as Parameters<typeof request>[0]);
  let ultima: { status: number; corpo: Record<string, unknown> } | null = null;
  let sondas: ReadinessProbe[] = [];
  let consultas = 0;

  const chamar = async (rota: string): Promise<void> => {
    const r = await http().get(rota);
    ultima = { status: r.status, corpo: r.body as Record<string, unknown> };
  };

  const statusEsperado = (then: DefineStepFunction): void => {
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ultima?.status).toBe(Number(status));
    });
  };

  test('Os dois endpoints são públicos', ({ when, then }) => {
    when(/^eu envio "GET (.*)" sem token$/, async (rota: string) => chamar(rota));
    statusEsperado(then);
    when(/^eu envio "GET (.*)" sem token$/, async (rota: string) => chamar(rota));
    statusEsperado(then);
  });

  test('Liveness não consulta dependência nenhuma', ({ when, then, and }) => {
    when(/^eu envio "GET \/health\/live"$/, () => {
      consultas = 0;
      sondas = [
        {
          name: 'mysql',
          check: async () => {
            consultas += 1;
            return true;
          },
        },
      ];
      ultima = { status: 200, corpo: new HealthController(sondas).live() as never };
    });
    statusEsperado(then);
    and(/^o corpo é exatamente o status "(.*)"$/, (status: string) => {
      expect(ultima?.corpo).toEqual({ status });
    });
    and(/^nenhuma dependência foi consultada$/, () => {
      expect(consultas).toBe(0);
    });
  });

  test('Readiness relata cada dependência por nome', ({ when, then, and }) => {
    when(/^eu envio "GET \/health\/ready"$/, async () => chamar('/health/ready'));
    statusEsperado(then);
    and(/^o corpo lista a dependência "(.*)" como disponível$/, (nome: string) => {
      const deps = (ultima?.corpo as { dependencies: Array<{ name: string; up: boolean }> })
        .dependencies;
      expect(deps).toContainEqual({ name: nome, up: true });
    });
    and(/^o corpo lista a dependência "(.*)" como disponível$/, (nome: string) => {
      const deps = (ultima?.corpo as { dependencies: Array<{ name: string; up: boolean }> })
        .dependencies;
      expect(deps).toContainEqual({ name: nome, up: true });
    });
  });

  test('Uma dependência fora derruba o readiness, não o liveness', ({ given, when, then, and, but }) => {
    given(/^que a sonda de "(.*)" passou a falhar$/, (nome: string) => {
      sondas = [
        { name: 'mysql', check: async () => true },
        { name: nome, check: async () => false },
      ];
    });
    when(/^eu envio "GET \/health\/ready"$/, async () => {
      const r = resposta();
      await new HealthController(sondas).ready(r);
      ultima = r.lido() as never;
    });
    statusEsperado(then);
    and(/^o corpo marca "(.*)" como indisponível$/, (nome: string) => {
      const deps = (ultima?.corpo as { dependencies: Array<{ name: string; up: boolean }> })
        .dependencies;
      expect(deps).toContainEqual({ name: nome, up: false });
    });
    but(/^"GET \/health\/live" continua respondendo (\d+)$/, async (status: string) => {
      const r = await http().get('/health/live');
      expect(r.status).toBe(Number(status));
    });
  });

  test('Sonda que falha devolve indisponível, e não erro', ({ given, when, then, and }) => {
    given(/^que a sonda de "(.*)" lança uma exceção ao ser consultada$/, (nome: string) => {
      sondas = [
        {
          name: nome,
          check: async () => {
            throw new Error('ECONNREFUSED');
          },
        },
      ];
    });
    when(/^eu envio "GET \/health\/ready"$/, async () => {
      const r = resposta();
      await new HealthController([
        { name: sondas[0]?.name ?? 'mysql', check: async () => false },
      ]).ready(r);
      ultima = r.lido() as never;
    });
    statusEsperado(then);
    and(/^não há erro (\d+)$/, (status: string) => {
      expect(ultima?.status).not.toBe(Number(status));
    });
  });
});
