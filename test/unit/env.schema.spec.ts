import { loadEnv } from '../../src/infrastructure/config/env.schema';

const MINIMO = {
  DB_HOST: 'db',
  DB_USER: 'orders',
  DB_PASSWORD: 'orders',
  DB_NAME: 'orders',
  AMQP_URL: 'amqp://localhost',
  JWT_SECRET: 'segredo',
};

describe('loadEnv', () => {
  it('aplica os defaults documentados quando so o obrigatorio vem', () => {
    const env = loadEnv(MINIMO);
    expect(env.appRole).toBe('api');
    expect(env.httpPort).toBe(3000);
    expect(env.prefetch).toBe(10);
    expect(env.retryTiersMs).toEqual([5_000, 15_000, 45_000]);
    expect(env.processingDelayMs).toBe(1_500);
    expect(env.outboxPollIntervalMs).toBe(500);
  });

  it('derruba a subida listando TUDO que falta, nao so o primeiro', () => {
    expect(() => loadEnv({})).toThrow(/DB_HOST[\s\S]*DB_USER[\s\S]*AMQP_URL[\s\S]*JWT_SECRET/);
  });

  it('recusa variavel presente porem vazia', () => {
    expect(() => loadEnv({ ...MINIMO, DB_PASSWORD: '   ' })).toThrow(/DB_PASSWORD/);
  });

  it.each(['api', 'relay', 'consumer'])('aceita o papel %s', (papel) => {
    expect(loadEnv({ ...MINIMO, APP_ROLE: papel }).appRole).toBe(papel);
  });

  it('recusa papel desconhecido em vez de subir como api', () => {
    expect(() => loadEnv({ ...MINIMO, APP_ROLE: 'worker' })).toThrow(/APP_ROLE/);
  });

  it.each([
    ['nao numerico', 'abc'],
    ['zero', '0'],
    ['negativo', '-1'],
  ])('recusa porta %s', (_caso, valor) => {
    expect(() => loadEnv({ ...MINIMO, DB_PORT: valor })).toThrow(/DB_PORT/);
  });

  it('le a lista de degraus de backoff', () => {
    expect(loadEnv({ ...MINIMO, RETRY_TIERS_MS: '200, 400, 800' }).retryTiersMs).toEqual([200, 400, 800]);
  });

  it('recusa lista de backoff malformada', () => {
    expect(() => loadEnv({ ...MINIMO, RETRY_TIERS_MS: '200,abc' })).toThrow(/RETRY_TIERS_MS/);
    expect(() => loadEnv({ ...MINIMO, RETRY_TIERS_MS: '0,100' })).toThrow(/RETRY_TIERS_MS/);
  });

  it('aceita o provedor de identidade local', () => {
    expect(loadEnv({ ...MINIMO, AUTH_PROVIDER: 'local' }).authProvider).toBe('local');
  });

  it('aceita o provedor keycloak quando a configuração dele vem junto', () => {
    const env = loadEnv({
      ...MINIMO,
      AUTH_PROVIDER: 'keycloak',
      KEYCLOAK_ISSUER: 'http://kc/realms/loja',
      KEYCLOAK_CLIENT_ID: 'app',
      KEYCLOAK_CLIENT_SECRET: 'segredo',
    });
    expect(env.authProvider).toBe('keycloak');
  });

  it('sem AUTH_PROVIDER, usa o local', () => {
    expect(loadEnv(MINIMO).authProvider).toBe('local');
  });

  it('recusa provedor de identidade desconhecido', () => {
    expect(() => loadEnv({ ...MINIMO, AUTH_PROVIDER: 'auth0' })).toThrow(/AUTH_PROVIDER/);
  });

  it('com keycloak, as variáveis do provedor viram obrigatórias', () => {
    expect(() => loadEnv({ ...MINIMO, AUTH_PROVIDER: 'keycloak' })).toThrow(
      /KEYCLOAK_ISSUER[\s\S]*KEYCLOAK_CLIENT_ID[\s\S]*KEYCLOAK_CLIENT_SECRET/,
    );
  });

  it('com local, as variáveis do keycloak são opcionais', () => {
    const env = loadEnv(MINIMO);
    expect(env.keycloak).toEqual({ issuer: '', clientId: '', clientSecret: '' });
  });

  it('lê a configuração completa do keycloak quando ele está ativo', () => {
    const env = loadEnv({
      ...MINIMO,
      AUTH_PROVIDER: 'keycloak',
      KEYCLOAK_ISSUER: 'http://kc/realms/loja',
      KEYCLOAK_CLIENT_ID: 'app',
      KEYCLOAK_CLIENT_SECRET: 'segredo',
    });
    expect(env.keycloak).toEqual({
      issuer: 'http://kc/realms/loja',
      clientId: 'app',
      clientSecret: 'segredo',
    });
  });

  it('aceita atraso de processamento zero, que e o usado nos testes', () => {
    expect(loadEnv({ ...MINIMO, PROCESSING_DELAY_MS: '0' }).processingDelayMs).toBe(0);
  });
});
