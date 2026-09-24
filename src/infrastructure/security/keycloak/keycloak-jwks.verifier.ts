import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenVerifier, VerifiedIdentity } from '../../../domain/ports/system/token-verifier.port';
import { UserRole } from '../../../domain/user/user-role.enum';
import { JwksCache } from './jwks.cache';
import { KeycloakAccessTokenClaims, extrairSubject, mapearPapeis } from './keycloak-roles.mapper';

@Injectable()
export class KeycloakJwksVerifier implements TokenVerifier {
  private static readonly PAPEIS_CONHECIDOS: readonly string[] = Object.values(UserRole);

  private readonly jwks: JwksCache;

  constructor(
    private readonly jwt: JwtService,
    private readonly issuer: string,
    private readonly clientId: string,
    jwks?: JwksCache,
  ) {
    this.jwks = jwks ?? new JwksCache(`${issuer}/protocol/openid-connect/certs`);
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    const publicKey = await this.chavePublicaDe(token);
    const payload = await this.jwt.verifyAsync<KeycloakAccessTokenClaims>(token, {
      // `secret` e nao `publicKey`: o @nestjs/jwt da precedencia ao segredo
      // registrado no modulo sobre a opcao `publicKey` do verify, e o token
      // RS256 acabava sendo validado contra o segredo simetrico do modo local —
      // recusado com "secretOrPublicKey must be an asymmetric key". O
      // jsonwebtoken aceita PEM neste campo, que e o que passamos aqui.
      secret: publicKey,
      algorithms: ['RS256'],
      issuer: this.issuer,
      audience: this.clientId,
    });
    return {
      subject: extrairSubject(payload),
      roles: mapearPapeis(payload, KeycloakJwksVerifier.PAPEIS_CONHECIDOS, this.clientId),
    };
  }

  /**
   * Lê o `kid` do cabeçalho SEM verificar nada — e isso é seguro porque o
   * cabeçalho só escolhe qual chave usar. Se o `kid` for forjado, ou a chave não
   * existe (erro) ou a assinatura não confere (erro). O cabeçalho nunca decide
   * se o token vale.
   */
  private async chavePublicaDe(token: string): Promise<string> {
    const [cabecalhoBruto] = token.split('.');
    if (cabecalhoBruto === undefined || cabecalhoBruto === '') {
      throw new Error('Token sem cabecalho JWT');
    }
    const cabecalho = JSON.parse(Buffer.from(cabecalhoBruto, 'base64url').toString('utf8')) as {
      kid?: unknown;
      alg?: unknown;
    };
    if (cabecalho.alg !== 'RS256') {
      // Recusa explícita ao "alg confusion": um token dizendo `alg: HS256` não
      // pode fazer a chave pública ser usada como segredo simétrico.
      throw new Error(`Algoritmo nao aceito: ${String(cabecalho.alg)}`);
    }
    if (typeof cabecalho.kid !== 'string') {
      throw new Error('Token sem kid no cabecalho');
    }
    return this.jwks.chavePublica(cabecalho.kid);
  }
}
