import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';

import { World } from './world';

export type SituacaoDeToken =
  | 'expirado'
  | 'assinado com outro segredo'
  | 'com o payload adulterado'
  | 'malformado';

export interface ProvedorDeIdentidade {
  readonly nome: 'local' | 'keycloak';
  papelDoToken(token: string, world: World): string | undefined;
  tokenInvalido(situacao: SituacaoDeToken, world: World): Promise<string>;
}

const payloadDe = (token: string): Record<string, unknown> => {
  const [, corpo] = token.split('.');
  return JSON.parse(Buffer.from(String(corpo), 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
};

const adulterarPayload = (token: string, mudanca: Record<string, unknown>): string => {
  const [cabecalho, , assinatura] = token.split('.');
  const novo = Buffer.from(JSON.stringify({ ...payloadDe(token), ...mudanca })).toString(
    'base64url',
  );
  return [cabecalho, novo, assinatura].join('.');
};

export const PROVEDOR_LOCAL: ProvedorDeIdentidade = {
  nome: 'local',

  papelDoToken(token) {
    const papel = payloadDe(token)['role'];
    return typeof papel === 'string' ? papel : undefined;
  },

  async tokenInvalido(situacao, world) {
    const jwt = world.app.get(JwtService);
    switch (situacao) {
      case 'expirado':
        return jwt.sign({ sub: 'u', role: 'CUSTOMER' }, { expiresIn: '-1s' });
      case 'assinado com outro segredo':
        return new JwtService({ secret: 'outro-segredo' }).sign({ sub: 'u', role: 'CUSTOMER' });
      case 'com o payload adulterado':
        return adulterarPayload(jwt.sign({ sub: 'u', role: 'CUSTOMER' }), { role: 'ADMIN' });
      case 'malformado':
        return 'isto.nao.e.um.jwt';
    }
  },
};

const KEYCLOAK = 'http://localhost:8082/realms/loja';

const tokenDoKeycloak = async (clientId: string, secret: string): Promise<string> => {
  const resposta = await fetch(`${KEYCLOAK}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: secret,
      username: 'cliente@loja.test',
      password: 'cliente123',
    }),
  });
  const { access_token: token } = (await resposta.json()) as { access_token: string };
  return token;
};

export const PROVEDOR_KEYCLOAK: ProvedorDeIdentidade = {
  nome: 'keycloak',

  papelDoToken(token) {
    const acesso = payloadDe(token)['realm_access'];
    const papeis = (acesso as { roles?: unknown } | undefined)?.roles;
    return Array.isArray(papeis)
      ? papeis.find((papel): papel is string => papel === 'CUSTOMER' || papel === 'ADMIN')
      : undefined;
  },

  async tokenInvalido(situacao) {
    switch (situacao) {
      case 'expirado': {
        // Expirado DE VERDADE: o realm tem um client com `access.token.lifespan`
        // de 1 s e um mapper de audiência apontando para a API. Assinatura
        // válida, emissor certo, audiência certa — só o `exp` passou. Forjar a
        // expiração adulterando o payload testaria assinatura, não expiração.
        const token = await tokenDoKeycloak('async-order-processor-curto', 'segredo-do-cliente-curto');
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        return token;
      }
      case 'assinado com outro segredo': {
        // RS256 assinado por uma chave que não está no JWKS do provedor: é o
        // caso realista de "outro emissor", e exercita a busca de `kid`.
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        return new JwtService({
          privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
          signOptions: { algorithm: 'RS256', keyid: 'chave-que-nao-existe' },
        }).sign({ sub: 'u', realm_access: { roles: ['ADMIN'] }, aud: 'async-order-processor' });
      }
      case 'com o payload adulterado': {
        const token = await tokenDoKeycloak(
          'async-order-processor',
          'segredo-de-desenvolvimento-trocar-em-producao',
        );
        return adulterarPayload(token, { realm_access: { roles: ['ADMIN'] } });
      }
      case 'malformado':
        return 'isto.nao.e.um.jwt';
    }
  },
};
