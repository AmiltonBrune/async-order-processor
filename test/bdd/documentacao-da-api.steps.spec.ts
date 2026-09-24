import { defineFeature, loadFeature } from 'jest-cucumber';
import request from 'supertest';

import { useWorld } from '../support/setup-world';

const feature = loadFeature('features/documentacao-da-api.feature');
const world = useWorld();

interface EspecificacaoOpenApi {
  paths: Record<string, Record<string, OperacaoOpenApi>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme?: string }>;
    schemas: Record<string, { properties?: Record<string, unknown> }>;
  };
}

interface OperacaoOpenApi {
  responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  requestBody?: { content: Record<string, { examples?: Record<string, unknown> }> };
  security?: Array<Record<string, unknown>>;
}

const nomeDoSchema = (ref: string | undefined): string => String(ref).split('/').pop() ?? '';

defineFeature(feature, (test) => {
  const http = () => request(world().httpServer as Parameters<typeof request>[0]);
  let spec: EspecificacaoOpenApi;
  let resposta: request.Response;

  const lerEspecificacao = async (): Promise<void> => {
    resposta = await http().get('/docs-json');
    spec = resposta.body as EspecificacaoOpenApi;
  };

  test('A documentação é pública e não exige token', ({ when, then }) => {
    when(/^eu envio "GET \/docs" sem token$/, async () => {
      resposta = await http().get('/docs');
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(resposta.status).toBe(Number(status));
    });
  });

  test('Toda rota implementada está documentada', ({ when, then, and }) => {
    when(/^eu leio a especificação em "(.*)"$/, lerEspecificacao);
    then(
      /^todas estas rotas aparecem documentadas:$/,
      (tabela: Array<{ metodo: string; rota: string }>) => {
        for (const { metodo, rota } of tabela) {
          expect(spec.paths[rota]?.[metodo.toLowerCase()]).toBeDefined();
        }
      },
    );
    and(/^nenhuma rota documentada deixou de existir na aplicação$/, async () => {
      for (const [rota, operacoes] of Object.entries(spec.paths)) {
        for (const metodo of Object.keys(operacoes)) {
          const alvo = rota.replace('{id}', '0193a000-0000-7000-8000-000000000001');
          const r = await (metodo === 'post' ? http().post(alvo) : http().get(alvo));
          expect(r.status).not.toBe(404);
        }
      }
    });
  });

  test('Cada resposta tem schema, não só um código', ({ when, then, and }) => {
    when(/^eu leio a especificação em "(.*)"$/, lerEspecificacao);
    then(/^"POST \/orders" documenta as respostas (\d+), (\d+), (\d+) e (\d+)$/, (...codigos: string[]) => {
      const operacao = spec.paths['/orders']?.['post'];
      for (const codigo of codigos.slice(0, 4)) {
        expect(operacao?.responses[codigo]).toBeDefined();
      }
    });
    and(/^o corpo de sucesso tem schema com "(.*)", "(.*)", "(.*)" e "(.*)"$/, (...campos: string[]) => {
      const ref = spec.paths['/orders']?.['post']?.responses['201']?.content?.['application/json']
        ?.schema?.$ref;
      const schema = spec.components.schemas[nomeDoSchema(ref)];
      for (const campo of campos.slice(0, 4)) {
        expect(schema?.properties?.[campo]).toBeDefined();
      }
    });
    and(/^o corpo de erro tem schema com "(.*)", "(.*)" e "(.*)"$/, (...campos: string[]) => {
      const ref = spec.paths['/orders']?.['post']?.responses['422']?.content?.['application/json']
        ?.schema?.$ref;
      const schema = spec.components.schemas[nomeDoSchema(ref)];
      for (const campo of campos.slice(0, 3)) {
        expect(schema?.properties?.[campo]).toBeDefined();
      }
    });
  });

  test('Dá para testar sem inventar payload', ({ when, then, and }) => {
    when(/^eu leio a especificação em "(.*)"$/, lerEspecificacao);

    const exemplosDe = (rota: string): Record<string, unknown> =>
      spec.paths[rota]?.['post']?.requestBody?.content['application/json']?.examples ?? {};

    then(/^"POST \/auth\/login" traz exemplos prontos de credenciais$/, () => {
      expect(Object.keys(exemplosDe('/auth/login')).length).toBeGreaterThanOrEqual(2);
    });
    and(/^"POST \/orders" traz um exemplo de pedido válido$/, () => {
      expect(exemplosDe('/orders')['valido']).toBeDefined();
    });
    and(/^"POST \/orders" traz um exemplo do cenário de estoque insuficiente$/, () => {
      expect(exemplosDe('/orders')['estoqueInsuficiente']).toBeDefined();
    });
  });

  test('A documentação declara o esquema de autenticação', ({ when, then, and }) => {
    when(/^eu leio a especificação em "(.*)"$/, lerEspecificacao);
    then(/^existe um esquema de segurança "(.*)" do tipo "(.*)"$/, (nome: string, tipo: string) => {
      expect(spec.components.securitySchemes[nome]).toMatchObject({ type: tipo });
    });
    and(/^as rotas de pedido exigem esse esquema$/, () => {
      expect(spec.paths['/orders']?.['post']?.security).toBeDefined();
    });
    and(/^as rotas de saúde não exigem$/, () => {
      expect(spec.paths['/health/ready']?.['get']?.security).toBeUndefined();
    });
  });
});
