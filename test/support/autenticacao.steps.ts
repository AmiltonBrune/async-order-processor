import { DefineStepFunction } from 'jest-cucumber';

import { ProvedorDeIdentidade, SituacaoDeToken } from './provedor-de-identidade';
import { CATALOGO_PADRAO } from './setup-world';
import { Contexto } from './steps';
import { World } from './world';

interface PassosDoCenario {
  readonly given: DefineStepFunction;
  readonly when: DefineStepFunction;
  readonly then: DefineStepFunction;
  readonly and: DefineStepFunction;
  readonly but: DefineStepFunction;
  readonly pending: () => void;
}

type Definidor = (nome: string, corpo: (passos: PassosDoCenario) => void) => void;

export function definirCenariosDeAutenticacao(
  test: Definidor,
  world: () => World,
  provedor: ProvedorDeIdentidade,
): void {
  let ctx: Contexto;

  const usuarios = (given: DefineStepFunction): void => {
    given(/^os usuários semeados:$/, async () => {
      ctx = new Contexto(world());
      await ctx.catalogo(
        CATALOGO_PADRAO.map((p) => ({ nome: p.nome, preco: p.preco, estoque: String(p.estoque) })),
      );
    });
  };

  const statusEsperado = (then: DefineStepFunction): void => {
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(ctx.resposta?.status).toBe(Number(status));
    });
  };

  const codigoDeErro = (and: DefineStepFunction): void => {
    and(/^o campo "code" do corpo de erro é "(.*)"$/, (code: string) => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe(code);
    });
  };

  test('Login válido devolve um JWT utilizável', ({ given, when, then, and }) => {
    usuarios(given);

    when(/^eu envio "POST \/auth\/login" com "(.*)" e "(.*)"$/, async (email: string, senha: string) => {
      await ctx.post('/auth/login', { email, password: senha });
    });
    statusEsperado(then);
    and(/^a resposta traz um "(.*)"$/, (campo: string) => {
      expect((ctx.resposta?.body as Record<string, unknown>)[campo]).toEqual(expect.any(String));
    });
    and(
      /^o token identifica o usuário, carrega o papel "(.*)" e expira no futuro$/,
      (papelEsperado: string) => {
        const token = String((ctx.resposta?.body as { accessToken: string }).accessToken);
        const payload = JSON.parse(
          Buffer.from(String(token.split('.')[1]), 'base64url').toString('utf8'),
        ) as { sub?: string; exp?: number };

        expect(payload.sub).toBeTruthy();
        expect(provedor.papelDoToken(token, world())).toBe(papelEsperado);
        expect(Number(payload.exp) * 1000).toBeGreaterThan(Date.now());
      },
    );
    and(/^o token não contém o hash da senha$/, () => {
      const token = String((ctx.resposta?.body as { accessToken: string }).accessToken);
      const payload = Buffer.from(String(token.split('.')[1]), 'base64url').toString('utf8');
      expect(payload).not.toContain('scrypt');
      expect(payload).not.toContain('passwordHash');
      expect(payload.toLowerCase()).not.toContain('password');
    });
  });

  test('Login inválido não diz o que estava errado', ({ given, when, then, and }) => {
    usuarios(given);

    when(/^eu envio "POST \/auth\/login" com "(.*)" e "(.*)"$/, async (email: string, senha: string) => {
      await ctx.post('/auth/login', { email, password: senha });
    });
    statusEsperado(then);
    and(/^o campo "code" do corpo de erro é "(.*)"$/, () => {
      expect((ctx.resposta?.body as { code?: string }).code).toBe('UNAUTHORIZED');
    });
    and(/^a mensagem é a mesma nos dois casos$/, () => {
      expect((ctx.resposta?.body as { message?: string }).message).toBe('Credenciais invalidas');
    });
  });

  test('Endpoints protegidos exigem token', ({ given, when, then, and }) => {
    usuarios(given);

    when(/^eu envio "(.*) (.*)" sem token$/, async (metodo: string, rota: string) => {
      const alvo = rota.replace('{id}', '0193a000-0000-7000-8000-000000000009');
      ctx.token = null;
      await (metodo === 'POST' ? ctx.post(alvo, {}) : ctx.get(alvo));
    });
    statusEsperado(then);
    codigoDeErro(and);
  });

  test('Token inválido é recusado', ({ given, when, then }) => {
    usuarios(given);

    when(/^eu envio "GET \/orders" com um token (.*)$/, async (situacao: string) => {
      ctx.token = await provedor.tokenInvalido(situacao.trim() as SituacaoDeToken, world());
      await ctx.get('/orders');
    });
    statusEsperado(then);
  });

  test('Papel insuficiente é 403, não 401', ({ given, when, then, and }) => {
    usuarios(given);

    given(/^que estou autenticado com o papel "(.*)"$/, async (papel: string) => {
      await ctx.autenticar(papel);
    });
    when(/^eu envio "POST \/orders\/\{id\}\/reprocess" para um pedido "(.*)"$/, async () => {
      const id = await ctx.criarPedido('Ana Souza', [{ produto: 'Teclado', quantidade: '1' }]);
      await world().dataSource.query(
        `UPDATE orders SET status = 'FAILED', failure_code = 'INSUFFICIENT_STOCK',
           failure_reason = 'estoque insuficiente' WHERE id = ?`,
        [id],
      );
      await ctx.post(`/orders/${id}/reprocess`, {});
    });
    statusEsperado(then);
    codigoDeErro(and);
  });

  test('Rotas públicas continuam abertas', ({ given, when, then }) => {
    usuarios(given);

    when(/^eu envio "GET (.*)" sem token$/, async (rota: string) => {
      ctx.token = null;
      await ctx.get(rota);
    });
    statusEsperado(then);
  });
}
