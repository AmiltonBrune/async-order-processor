import { JwtService } from '@nestjs/jwt';
import { generateKeyPairSync } from 'node:crypto';

import { JwksCache } from '../../src/infrastructure/security/keycloak/jwks.cache';
import { KeycloakJwksVerifier } from '../../src/infrastructure/security/keycloak/keycloak-jwks.verifier';

const ISSUER = 'http://keycloak/realms/loja';
const CLIENT = 'async-order-processor';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM_PRIVADA = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PEM_PUBLICA = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const cacheFalso = (pem: string | Error = PEM_PUBLICA): JwksCache =>
  ({
    chavePublica: async () => {
      if (pem instanceof Error) throw pem;
      return pem;
    },
  }) as unknown as JwksCache;

const assinar = (payload: Record<string, unknown>, opcoes: Record<string, unknown> = {}): string =>
  new JwtService({
    privateKey: PEM_PRIVADA,
    signOptions: { algorithm: 'RS256', keyid: 'kid-1', issuer: ISSUER, audience: CLIENT },
  }).sign(payload, opcoes);

const verificador = (cache = cacheFalso()) =>
  new KeycloakJwksVerifier(new JwtService({ secret: 'irrelevante' }), ISSUER, CLIENT, cache);

describe('KeycloakJwksVerifier', () => {
  it('aceita token RS256 válido e traduz os papéis', async () => {
    const token = assinar({ sub: 'f:loja:1', realm_access: { roles: ['CUSTOMER', 'offline_access'] } });
    await expect(verificador().verify(token)).resolves.toEqual({
      subject: 'f:loja:1',
      roles: ['CUSTOMER'],
    });
  });

  it('recusa token assinado por chave que não está no JWKS', async () => {
    const outro = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = new JwtService({
      privateKey: outro.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      signOptions: { algorithm: 'RS256', keyid: 'kid-1', issuer: ISSUER, audience: CLIENT },
    }).sign({ sub: 'u' });
    await expect(verificador().verify(token)).rejects.toThrow();
  });

  it('recusa emissor diferente, mesmo com assinatura válida', async () => {
    const token = assinar({ sub: 'u' }, { issuer: 'http://keycloak/realms/outro' });
    await expect(verificador().verify(token)).rejects.toThrow();
  });

  it('recusa audiência de outro client', async () => {
    const token = assinar({ sub: 'u' }, { audience: 'outro-sistema' });
    await expect(verificador().verify(token)).rejects.toThrow();
  });

  it('recusa token expirado', async () => {
    const token = assinar({ sub: 'u' }, { expiresIn: '-10s' });
    await expect(verificador().verify(token)).rejects.toThrow();
  });

  describe('cabeçalho do token', () => {
    it('recusa alg diferente de RS256 — defesa contra "alg confusion"', async () => {
      const hs256 = new JwtService({ secret: PEM_PUBLICA }).sign(
        { sub: 'u' },
        { issuer: ISSUER, audience: CLIENT },
      );
      await expect(verificador().verify(hs256)).rejects.toThrow(/Algoritmo nao aceito/);
    });

    it('recusa token sem kid', async () => {
      const semKid = new JwtService({
        privateKey: PEM_PRIVADA,
        signOptions: { algorithm: 'RS256' },
      }).sign({ sub: 'u' });
      await expect(verificador().verify(semKid)).rejects.toThrow(/sem kid/);
    });

    it('recusa token sem cabeçalho', async () => {
      await expect(verificador().verify('')).rejects.toThrow(/sem cabecalho/i);
    });
  });

  it('propaga a falha quando o JWKS está inacessível', async () => {
    const token = assinar({ sub: 'u' });
    await expect(verificador(cacheFalso(new Error('ECONNREFUSED'))).verify(token)).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('token sem papel nenhum vira identidade sem papéis, não erro', async () => {
    const token = assinar({ sub: 'u' });
    await expect(verificador().verify(token)).resolves.toEqual({ subject: 'u', roles: [] });
  });
});
