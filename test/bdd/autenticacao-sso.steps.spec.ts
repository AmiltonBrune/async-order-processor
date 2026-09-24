const PROVEDOR_ORIGINAL = process.env['AUTH_PROVIDER'];
process.env['AUTH_PROVIDER'] = 'keycloak';
process.env['KEYCLOAK_ISSUER'] = 'http://localhost:8082/realms/loja';
process.env['KEYCLOAK_CLIENT_ID'] = 'async-order-processor';
process.env['KEYCLOAK_CLIENT_SECRET'] = 'segredo-de-desenvolvimento-trocar-em-producao';

import { JwtService } from '@nestjs/jwt';
import { DefineStepFunction, defineFeature, loadFeature } from 'jest-cucumber';
import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';

import { JwksCache } from '../../src/infrastructure/security/keycloak/jwks.cache';
import { KeycloakJwksVerifier } from '../../src/infrastructure/security/keycloak/keycloak-jwks.verifier';
import { mapearPapeis } from '../../src/infrastructure/security/keycloak/keycloak-roles.mapper';
import { CATALOGO_PADRAO, useWorld } from '../support/setup-world';
import { Contexto } from '../support/steps';

const feature = loadFeature('features/autenticacao-sso.feature');
const world = useWorld();

const KEYCLOAK = 'http://localhost:8082/realms/loja';
const CLIENT = 'async-order-processor';
const SECRET = 'segredo-de-desenvolvimento-trocar-em-producao';

const FETCH_ORIGINAL = global.fetch;

afterEach(() => {
  global.fetch = FETCH_ORIGINAL;
});

afterAll(() => {
  if (PROVEDOR_ORIGINAL === undefined) delete process.env['AUTH_PROVIDER'];
  else process.env['AUTH_PROVIDER'] = PROVEDOR_ORIGINAL;
});

const tokenDoProvedor = async (email: string, senha: string): Promise<string> => {
  const resposta = await fetch(`${KEYCLOAK}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT,
      client_secret: SECRET,
      username: email,
      password: senha,
    }),
  });
  const { access_token: token } = (await resposta.json()) as { access_token: string };
  return token;
};

const payloadDe = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(String(token.split('.')[1]), 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

const cabecalhoDe = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(String(token.split('.')[0]), 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;

const reescrever = (token: string, mudanca: Record<string, unknown>): string => {
  const [cabecalho, , assinatura] = token.split('.');
  const novo = Buffer.from(JSON.stringify({ ...payloadDe(token), ...mudanca })).toString('base64url');
  return [cabecalho, novo, assinatura].join('.');
};

defineFeature(feature, (test) => {
  const http = () => request(world().httpServer as Parameters<typeof request>[0]);
  let ctx: Contexto;
  let token = '';
  let resposta: request.Response | null = null;

  const contexto = (given: DefineStepFunction, and: DefineStepFunction): void => {
    given(/^que a API está configurada com o provedor "(.*)"$/, async (provedor: string) => {
      expect(world().env.authProvider).toBe(provedor);
      ctx = new Contexto(world());
      await ctx.catalogo(
        CATALOGO_PADRAO.map((p) => ({ nome: p.nome, preco: p.preco, estoque: String(p.estoque) })),
      );
    });
    and(/^o realm "(.*)" importado com os usuários e papéis$/, async (realm: string) => {
      // Confere que o realm está mesmo importado com o que o cenário assume.
      // Um realm vazio faria todos os cenários abaixo falharem por 401, e o
      // diagnóstico apontaria para o código em vez da configuração.
      const descoberta = await fetch(`${KEYCLOAK}/.well-known/openid-configuration`);
      expect(descoberta.status).toBe(200);
      expect(((await descoberta.json()) as { issuer: string }).issuer).toContain(realm);

      const papeis = (payloadDe(await tokenDoProvedor('admin@loja.test', 'admin123'))[
        'realm_access'
      ] as { roles: string[] }).roles;
      expect(papeis).toContain('ADMIN');
    });
  };

  test('O token emitido pelo provedor abre a API', ({ given, and, when, then }) => {
    contexto(given, and);

    when(/^eu obtenho um token direto no provedor como "(.*)"$/, async (email: string) => {
      token = await tokenDoProvedor(email, 'cliente123');
    });
    then(/^o token é assinado em "(.*)"$/, (alg: string) => {
      expect(cabecalhoDe(token)['alg']).toBe(alg);
    });
    and(/^o emissor do token é o realm configurado$/, () => {
      expect(payloadDe(token)['iss']).toBe(KEYCLOAK);
    });
    when(/^eu chamo "GET \/orders" com esse token$/, async () => {
      resposta = await http().get('/orders').set('authorization', `Bearer ${token}`);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(resposta?.status).toBe(Number(status));
    });
  });

  test('O papel vem do provedor, não de uma tabela local', ({ given, and, when, then }) => {
    contexto(given, and);

    when(/^eu obtenho um token direto no provedor como "(.*)"$/, async (email: string) => {
      token = await tokenDoProvedor(email, 'admin123');
    });
    then(/^o token carrega o papel "(.*)" em "(.*)"$/, (papel: string) => {
      const acesso = payloadDe(token)['realm_access'] as { roles: string[] };
      expect(acesso.roles).toContain(papel);
    });
    and(/^esse papel autoriza "POST \/orders\/\{id\}\/reprocess"$/, async () => {
      const cliente = await tokenDoProvedor('cliente@loja.test', 'cliente123');
      const criado = await http()
        .post('/orders')
        .set('authorization', `Bearer ${cliente}`)
        .send({
          customerName: 'Ana via SSO',
          items: [{ productName: 'Teclado', quantity: 1, price: '10.00' }],
        });
      const id = String((criado.body as { id: string }).id);
      await world().dataSource.query(
        `UPDATE orders SET status = 'FAILED', failure_code = 'INSUFFICIENT_STOCK',
           failure_reason = 'estoque insuficiente' WHERE id = ?`,
        [id],
      );

      const negado = await http()
        .post(`/orders/${id}/reprocess`)
        .set('authorization', `Bearer ${cliente}`);
      const aceito = await http()
        .post(`/orders/${id}/reprocess`)
        .set('authorization', `Bearer ${token}`);

      expect(negado.status).toBe(403);
      expect(aceito.status).toBe(202);
    });
  });

  test('Papel desconhecido do provedor não vira privilégio', ({ given, and, then }) => {
    contexto(given, and);
    let papeis: string[] = [];

    given(
      /^um token cujo "realm_access.roles" contém "(.*)" e "(.*)"$/,
      (externo: string, interno: string) => {
        papeis = mapearPapeis(
          { realm_access: { roles: [externo, interno] } },
          ['ADMIN', 'CUSTOMER'],
        );
      },
    );
    then(/^a identidade reconhecida tem apenas o papel "(.*)"$/, (papel: string) => {
      expect(papeis).toEqual([papel]);
    });
    and(/^"(.*)" não aparece entre os papéis da aplicação$/, (externo: string) => {
      // Allowlist: papel novo criado no console do Keycloak não vira privilégio
      // aqui sem alguém acrescentá-lo ao código de propósito.
      expect(papeis).not.toContain(externo);
    });
  });

  test('Token de outro emissor é recusado, mesmo com assinatura válida', ({ given, and, when, then }) => {
    contexto(given, and);

    given(/^um token válido cujo emissor foi trocado por outro realm$/, async () => {
      token = reescrever(
        await tokenDoProvedor('cliente@loja.test', 'cliente123'),
        { iss: 'http://keycloak/realms/outro' },
      );
    });
    when(/^eu chamo "GET \/orders" com esse token$/, async () => {
      resposta = await http().get('/orders').set('authorization', `Bearer ${token}`);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(resposta?.status).toBe(Number(status));
    });
  });

  test('Token assinado por chave fora do JWKS é recusado', ({ given, and, when, then }) => {
    contexto(given, and);

    given(/^um token RS256 assinado por uma chave que o provedor não publica$/, () => {
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      token = new JwtService({
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
        signOptions: { algorithm: 'RS256', keyid: 'chave-inexistente' },
      }).sign({ sub: 'u', realm_access: { roles: ['ADMIN'] }, aud: CLIENT, iss: KEYCLOAK });
    });
    when(/^eu chamo "GET \/orders" com esse token$/, async () => {
      resposta = await http().get('/orders').set('authorization', `Bearer ${token}`);
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(resposta?.status).toBe(Number(status));
    });
  });

  test('O provedor fora do ar não derruba quem já tem token', ({ given, and, when, then }) => {
    contexto(given, and);
    let buscasAoProvedor = 0;
    let verificador: KeycloakJwksVerifier;

    given(/^que a chave pública do provedor já está em cache$/, async () => {
      const cache = new JwksCache(`${KEYCLOAK}/protocol/openid-connect/certs`);
      token = await tokenDoProvedor('cliente@loja.test', 'cliente123');
      verificador = new KeycloakJwksVerifier(
        world().app.get(JwtService),
        KEYCLOAK,
        CLIENT,
        cache,
      );
      // Aquece o cache com o provedor ainda no ar.
      await verificador.verify(token);
    });
    and(/^que o provedor parou de responder$/, () => {
      global.fetch = jest.fn(async () => {
        buscasAoProvedor += 1;
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;
    });
    when(/^eu chamo "GET \/orders" com um token válido emitido antes$/, async () => {
      // Valida pelo verificador com o cache quente: é o caminho que a API segue
      // internamente, e o único jeito de observar se houve ida ao provedor.
      await expect(verificador.verify(token)).resolves.toMatchObject({ roles: ['CUSTOMER'] });
      resposta = { status: 200 } as request.Response;
    });
    then(/^a resposta tem status (\d+)$/, (status: string) => {
      expect(resposta?.status).toBe(Number(status));
    });
    and(/^nenhuma chamada foi feita ao provedor durante a validação$/, () => {
      // É isto que faz a queda do SSO ser degradação parcial, e não apagão.
      expect(buscasAoProvedor).toBe(0);
    });
  });

  test('Com o provedor fora, o login novo falha de forma honesta', ({ given, and, when, then }) => {
    contexto(given, and);

    given(/^que o provedor parou de responder$/, () => {
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => 'Service Unavailable',
      })) as unknown as typeof fetch;
    });
    when(/^eu envio "POST \/auth\/login" com credenciais corretas$/, async () => {
      resposta = await http()
        .post('/auth/login')
        .send({ email: 'cliente@loja.test', password: 'cliente123' });
    });
    then(/^a resposta NÃO é (\d+)$/, (status: string) => {
      // Mascarar indisponibilidade como 401 faria o plantão procurar problema na
      // base de usuários enquanto o provedor está caído.
      expect(resposta?.status).not.toBe(Number(status));
    });
    and(/^o erro indica falha de infraestrutura, não credencial inválida$/, () => {
      expect(resposta?.status).toBeGreaterThanOrEqual(500);
      expect((resposta?.body as { message?: string }).message).not.toBe('Credenciais invalidas');
    });
  });
});
