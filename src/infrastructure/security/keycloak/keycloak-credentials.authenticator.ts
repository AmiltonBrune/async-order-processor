import { Injectable } from '@nestjs/common';

import { AccessToken } from '../../../domain/ports/system/access-token.port';
import { CredentialsAuthenticator } from '../../../domain/ports/system/credentials-authenticator.port';

interface RespostaDeToken {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
}

@Injectable()
export class KeycloakCredentialsAuthenticator implements CredentialsAuthenticator {
  constructor(
    private readonly issuer: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async authenticate(email: string, password: string): Promise<AccessToken | null> {
    const corpo = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      username: email,
      password,
      scope: 'openid',
    });

    const resposta = await fetch(`${this.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });

    // 401 é credencial errada — resposta esperada, não falha de integração.
    // Qualquer outro status é problema de verdade e precisa subir como erro,
    // para não virar "senha inválida" quando o Keycloak está fora do ar.
    if (resposta.status === 401 || resposta.status === 400) return null;
    if (!resposta.ok) {
      throw new Error(
        `Keycloak respondeu ${resposta.status} ao emitir token: ${await resposta.text()}`,
      );
    }

    const dados = (await resposta.json()) as RespostaDeToken;
    if (typeof dados.access_token !== 'string') {
      throw new Error('Keycloak devolveu uma resposta de token sem access_token');
    }
    return {
      accessToken: dados.access_token,
      expiresIn: typeof dados.expires_in === 'number' ? dados.expires_in : 0,
    };
  }
}
