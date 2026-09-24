import { generateKeyPairSync } from 'node:crypto';

import { JwksCache } from '../../src/infrastructure/security/keycloak/jwks.cache';

const parDeChaves = (kid: string) => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
};

const CHAVE_A = parDeChaves('chave-a');
const CHAVE_B = parDeChaves('chave-b');

const respostaCom = (keys: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ keys }),
});

describe('JwksCache', () => {
  let buscas: number;
  let responder: () => unknown;

  beforeEach(() => {
    buscas = 0;
    responder = () => respostaCom([CHAVE_A]);
    global.fetch = jest.fn(async () => {
      buscas += 1;
      const resultado = responder();
      if (resultado instanceof Error) throw resultado;
      return resultado as Response;
    }) as unknown as typeof fetch;
  });

  it('converte o JWK do provedor em chave pública PEM', async () => {
    const cache = new JwksCache('http://keycloak/certs');
    const pem = await cache.chavePublica('chave-a');
    expect(pem).toContain('BEGIN PUBLIC KEY');
  });

  it('NÃO chama o provedor a cada verificação', async () => {
    const cache = new JwksCache('http://keycloak/certs');
    for (let i = 0; i < 50; i += 1) await cache.chavePublica('chave-a');
    expect(buscas).toBe(1);
  });

  it('renova quando o TTL vence', async () => {
    const cache = new JwksCache('http://keycloak/certs', 1_000);
    await cache.chavePublica('chave-a', 0);
    await cache.chavePublica('chave-a', 500);
    expect(buscas).toBe(1);
    await cache.chavePublica('chave-a', 1_500);
    expect(buscas).toBe(2);
  });

  it('busca de novo quando aparece um kid desconhecido — rotação de chave', async () => {
    const cache = new JwksCache('http://keycloak/certs');
    await cache.chavePublica('chave-a');
    responder = () => respostaCom([CHAVE_A, CHAVE_B]);

    await expect(cache.chavePublica('chave-b')).resolves.toContain('BEGIN PUBLIC KEY');
    expect(buscas).toBe(2);
  });

  it('limita a renovação: kid forjado não vira DDoS contra o provedor', async () => {
    const cache = new JwksCache('http://keycloak/certs', 600_000, 30_000);
    await cache.chavePublica('chave-a', 0);

    for (let i = 0; i < 20; i += 1) {
      await expect(cache.chavePublica(`forjado-${i}`, 1_000 + i)).rejects.toThrow(/desconhecida/);
    }
    // Uma busca inicial + no máximo uma renovação dentro da janela.
    expect(buscas).toBeLessThanOrEqual(2);
  });

  it('serve a chave em cache quando a renovação falha', async () => {
    // Soluço de rede não pode invalidar uma chave RSA que continua boa. É o
    // stale-while-revalidate: degradar é melhor que recusar todo mundo.
    const cache = new JwksCache('http://keycloak/certs', 1_000);
    await cache.chavePublica('chave-a', 0);
    responder = () => new Error('ECONNREFUSED');

    await expect(cache.chavePublica('chave-a', 5_000)).resolves.toContain('BEGIN PUBLIC KEY');
  });

  it('sem nada em cache, o erro sobe em vez de virar token aceito', async () => {
    responder = () => new Error('ECONNREFUSED');
    const cache = new JwksCache('http://keycloak/certs');
    await expect(cache.chavePublica('chave-a')).rejects.toThrow('ECONNREFUSED');
  });

  it.each([
    ['resposta sem chaves', () => respostaCom([])],
    ['resposta não-ok', () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['corpo sem o campo keys', () => ({ ok: true, status: 200, json: async () => ({}) })],
  ])('recusa %s em vez de aceitar qualquer token', async (_caso, resposta) => {
    responder = resposta;
    const cache = new JwksCache('http://keycloak/certs');
    await expect(cache.chavePublica('chave-a')).rejects.toThrow();
  });

  it('buscas simultâneas viram UMA requisição ao provedor', async () => {
    // Na subida, dezenas de requisições chegam juntas com o cache vazio. Sem a
    // deduplicação, cada uma dispara sua própria busca e o provedor leva uma
    // rajada exatamente no pior momento.
    const cache = new JwksCache('http://keycloak/certs');
    await Promise.all(Array.from({ length: 20 }, () => cache.chavePublica('chave-a')));
    expect(buscas).toBe(1);
  });

  it('descarta chave sem kid, que não dá para referenciar', async () => {
    const { kid: _ignorado, ...semKid } = CHAVE_A as Record<string, unknown>;
    responder = () => respostaCom([semKid, CHAVE_B]);
    const cache = new JwksCache('http://keycloak/certs');
    await expect(cache.chavePublica('chave-b')).resolves.toContain('BEGIN PUBLIC KEY');
  });

  it('descarta chave de outro algoritmo', async () => {
    // Aceitar uma chave ES256 aqui e usá-la para verificar RS256 daria erro
    // obscuro no meio da verificação, em vez de "chave desconhecida".
    responder = () => respostaCom([{ ...CHAVE_A, alg: 'ES256' }, CHAVE_B]);
    const cache = new JwksCache('http://keycloak/certs');
    await expect(cache.chavePublica('chave-a')).rejects.toThrow(/desconhecida/);
    await expect(cache.chavePublica('chave-b')).resolves.toContain('BEGIN PUBLIC KEY');
  });

  it('ignora chave de cifragem: só assinatura RS256 entra', async () => {
    responder = () => respostaCom([{ ...CHAVE_A, use: 'enc' }, CHAVE_B]);
    const cache = new JwksCache('http://keycloak/certs');
    await expect(cache.chavePublica('chave-a')).rejects.toThrow(/desconhecida/);
    await expect(cache.chavePublica('chave-b')).resolves.toContain('BEGIN PUBLIC KEY');
  });
});
