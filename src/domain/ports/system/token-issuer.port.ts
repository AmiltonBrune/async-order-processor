import { AccessToken } from './access-token.port';

export const TOKEN_ISSUER = Symbol('TokenIssuer');

export interface TokenIssuer {
  issue(subject: string, role: string): Promise<AccessToken>;
}
