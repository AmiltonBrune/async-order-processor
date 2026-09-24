import { KeycloakCredentialsAuthenticator } from '../../src/infrastructure/security/keycloak/keycloak-credentials.authenticator';

const ISSUER = 'http://keycloak/realms/loja';

const autenticador = () =>
  new KeycloakCredentialsAuthenticator(ISSUER, 'async-order-processor', 'segredo');

const responderCom = (status: number, corpo: unknown, texto = '') => {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
    text: async () => texto,
  })) as unknown as typeof fetch;
};

describe('KeycloakCredentialsAuthenticator', () => {
  it('troca credenciais por token no endpoint do provedor', async () => {
    responderCom(200, { access_token: 'token-rs256', expires_in: 300 });

    await expect(autenticador().authenticate('cliente@loja.test', 'cliente123')).resolves.toEqual({
      accessToken: 'token-rs256',
      expiresIn: 300,
    });

    const [url, opcoes] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ISSUER}/protocol/openid-connect/token`);
    const corpo = String(opcoes.body);
    expect(corpo).toContain('grant_type=password');
    expect(corpo).toContain('client_id=async-order-processor');
    expect(corpo).toContain('username=cliente%40loja.test');
  });

  it.each([401, 400])('devolve null para %i — credencial errada é resposta esperada', async (status) => {
    responderCom(status, { error: 'invalid_grant' });
    await expect(autenticador().authenticate('a@b.test', 'errada')).resolves.toBeNull();
  });

  it.each([500, 502, 503])('LANÇA para %i — provedor fora do ar não é senha inválida', async (status) => {
    // Mascarar isto como 401 faria o plantão procurar problema na base de
    // usuários enquanto o Keycloak está caído.
    responderCom(status, {}, 'Service Unavailable');
    await expect(autenticador().authenticate('a@b.test', 'x')).rejects.toThrow(/respondeu 503|502|500/);
  });

  it('lança quando a resposta vem sem access_token', async () => {
    responderCom(200, { token_type: 'Bearer' });
    await expect(autenticador().authenticate('a@b.test', 'x')).rejects.toThrow(/sem access_token/);
  });

  it('tolera resposta sem expires_in', async () => {
    responderCom(200, { access_token: 'token' });
    await expect(autenticador().authenticate('a@b.test', 'x')).resolves.toEqual({
      accessToken: 'token',
      expiresIn: 0,
    });
  });
});
